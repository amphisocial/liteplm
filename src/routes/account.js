// src/routes/account.js — signup, login, logout, current user, user admin, tokens.
import { Router } from "express";
import { query } from "../db.js";
import { signupCompany, login, logout, addUser, createToken, requireAuth, requireRole } from "../auth.js";

const r = Router();
// secure follows the real protocol: false on local http, true behind nginx TLS
// (trust proxy + X-Forwarded-Proto makes req.secure accurate on EC2).
const cookie = (req, res, sid) => res.cookie("plm_sid", sid, { httpOnly: true, sameSite: "lax", secure: !!req.secure, maxAge: 1000 * 60 * 60 * 24 * 30 });

r.post("/signup", async (req, res) => {
  try {
    const user = await signupCompany(req.body || {});
    const { sid } = await login({ email: req.body.email, password: req.body.password });
    cookie(req, res, sid);
    res.json({ user });
  } catch (e) {
    const msg = String(e.message).includes("duplicate") ? "That email is already registered." : e.message;
    res.status(400).json({ error: msg });
  }
});

r.post("/login", async (req, res) => {
  try { const { sid, user } = await login(req.body || {}); cookie(req, res, sid); res.json({ user }); }
  catch (e) { res.status(401).json({ error: e.message }); }
});

r.post("/logout", async (req, res) => { await logout(req.cookies?.plm_sid); res.clearCookie("plm_sid"); res.json({ ok: true }); });

r.get("/me", requireAuth, (req, res) => res.json({ user: req.ctx.user, company_id: req.ctx.company_id }));

// ----- user administration (admin only) -----
r.get("/users", requireAuth, requireRole("admin"), async (req, res) => {
  res.json({ users: await query("SELECT id, name, email, role FROM users WHERE company_id=$1 ORDER BY id", [req.ctx.company_id]) });
});
r.post("/users", requireAuth, requireRole("admin"), async (req, res) => {
  try { res.json({ user: await addUser(req.ctx.company_id, req.body || {}) }); }
  catch (e) {
    const msg = String(e.message).includes("duplicate") ? "That email is already in use." : e.message;
    res.status(400).json({ error: msg });
  }
});

// ----- API tokens -----
r.get("/tokens", requireAuth, async (req, res) => {
  res.json({ tokens: await query("SELECT id, name, created_at FROM api_tokens WHERE company_id=$1 AND user_id=$2 ORDER BY id DESC", [req.ctx.company_id, req.ctx.user.id]) });
});
r.post("/tokens", requireAuth, async (req, res) => {
  const raw = await createToken(req.ctx.company_id, req.ctx.user.id, (req.body || {}).name);
  res.json({ token: raw, note: "Copy this now — it won't be shown again." });
});

export default r;
