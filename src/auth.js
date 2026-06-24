// src/auth.js — authentication + multi-tenant resolution.
// Every request is resolved to a { company_id, user } context, via either a
// session cookie (browser) or a Bearer API token (integrations). Downstream
// queries ALWAYS scope by req.ctx.company_id so tenants never see each other.
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { query, one } from "./db.js";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const rid = (n = 24) => crypto.randomBytes(n).toString("hex");

export async function signupCompany({ company, name, email, password }) {
  if (!company || !name || !email || !password) throw new Error("All fields are required.");
  const co = await one("INSERT INTO companies (name) VALUES ($1) RETURNING *", [company]);
  const hash = await bcrypt.hash(password, 10);
  const user = await one(
    "INSERT INTO users (company_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'admin') RETURNING id, company_id, email, name, role",
    [co.id, email.toLowerCase(), hash, name]
  );
  await seedWorkflow(co.id);
  return user;
}

// Default 2-step approval chain a new company starts with (admin can edit later).
async function seedWorkflow(companyId) {
  await query("INSERT INTO eco_workflow_steps (company_id, seq, name, role) VALUES ($1,1,'Engineering review','engineer'),($1,2,'Approval','approver')", [companyId]);
}

export async function addUser(companyId, { name, email, password, role }) {
  if (!name || !email || !password) throw new Error("Name, email and password are required.");
  const ok = ["admin", "engineer", "approver", "viewer"].includes(role) ? role : "engineer";
  const hash = await bcrypt.hash(password, 10);
  return one(
    "INSERT INTO users (company_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, company_id, email, name, role",
    [companyId, email.toLowerCase(), hash, name, ok]
  );
}

export async function login({ email, password }) {
  const u = await one("SELECT * FROM users WHERE email=$1 ORDER BY id LIMIT 1", [String(email || "").toLowerCase()]);
  if (!u) throw new Error("Invalid email or password.");
  const ok = await bcrypt.compare(password || "", u.password_hash);
  if (!ok) throw new Error("Invalid email or password.");
  const sid = rid();
  await query("INSERT INTO sessions (id, user_id, company_id) VALUES ($1,$2,$3)", [sid, u.id, u.company_id]);
  return { sid, user: { id: u.id, company_id: u.company_id, email: u.email, name: u.name, role: u.role } };
}

export async function logout(sid) {
  if (sid) await query("DELETE FROM sessions WHERE id=$1", [sid]);
}

export async function createToken(companyId, userId, name) {
  const raw = "plm_" + rid(20);
  await query("INSERT INTO api_tokens (company_id, user_id, name, token_hash) VALUES ($1,$2,$3,$4)", [companyId, userId, name || "token", sha(raw)]);
  return raw; // shown once
}

// Middleware: populate req.ctx from cookie session or Bearer token.
export async function resolveCtx(req, _res, next) {
  try {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) {
      const t = await one(
        "SELECT t.company_id, u.id, u.email, u.name, u.role FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1",
        [sha(auth.slice(7).trim())]
      );
      if (t) req.ctx = { company_id: t.company_id, user: { id: t.id, email: t.email, name: t.name, role: t.role }, via: "token" };
    } else if (req.cookies && req.cookies.plm_sid) {
      const s = await one(
        "SELECT s.company_id, u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1",
        [req.cookies.plm_sid]
      );
      if (s) req.ctx = { company_id: s.company_id, user: { id: s.id, email: s.email, name: s.name, role: s.role }, via: "session" };
    }
  } catch (_) { /* fall through unauthenticated */ }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.ctx) return res.status(401).json({ error: "Not signed in." });
  next();
}
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.ctx) return res.status(401).json({ error: "Not signed in." });
    if (!roles.includes(req.ctx.user.role)) return res.status(403).json({ error: "You don't have permission for this." });
    next();
  };
}
