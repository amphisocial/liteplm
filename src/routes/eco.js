// src/routes/eco.js — engineering change orders + the role-based approval workflow.
// The heart of PLM: an ECO walks the admin-defined step chain; each step is gated
// by a role; final approval IMPLEMENTS the ECO, which RELEASES (locks) every
// affected item revision.
import { Router } from "express";
import { query, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const r = Router();
r.use(requireAuth);
const co = (req) => req.ctx.company_id;

// ----- admin-configurable workflow -----
r.get("/workflow", async (req, res) => {
  res.json({ steps: await query("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq", [co(req)]) });
});
r.put("/workflow", requireRole("admin"), async (req, res) => {
  const steps = Array.isArray(req.body.steps) ? req.body.steps : [];
  if (!steps.length) return res.status(400).json({ error: "Add at least one approval step." });
  await query("DELETE FROM eco_workflow_steps WHERE company_id=$1", [co(req)]);
  let seq = 1;
  for (const s of steps) {
    const role = ["admin", "engineer", "approver", "viewer"].includes(s.role) ? s.role : "approver";
    await query("INSERT INTO eco_workflow_steps (company_id, seq, name, role) VALUES ($1,$2,$3,$4)", [co(req), seq++, s.name || `Step ${seq}`, role]);
  }
  res.json({ steps: await query("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq", [co(req)]) });
});

// ----- ECO list / detail -----
r.get("/ecos", async (req, res) => {
  res.json({ ecos: await query("SELECT * FROM ecos WHERE company_id=$1 ORDER BY id DESC", [co(req)]) });
});

r.get("/ecos/:id", async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  const affected = await query(
    `SELECT a.id, a.item_revision_id, iv.rev, iv.status, i.number, i.name
       FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id JOIN items i ON i.id=iv.item_id
     WHERE a.eco_id=$1 AND a.company_id=$2`, [eco.id, co(req)]);
  const steps = await query("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq", [co(req)]);
  const approvals = await query(
    "SELECT ea.*, u.name AS approver_name FROM eco_approvals ea LEFT JOIN users u ON u.id=ea.approver_id WHERE ea.eco_id=$1 AND ea.company_id=$2 ORDER BY ea.seq",
    [eco.id, co(req)]);
  const pendingStep = steps.find((s) => s.seq === eco.current_seq) || null;
  res.json({ eco, affected, steps, approvals, pendingStep });
});

// ----- create ECO -----
r.post("/ecos", requireRole("admin", "engineer"), async (req, res) => {
  const { number, title, description } = req.body || {};
  if (!number || !title) return res.status(400).json({ error: "ECO number and title are required." });
  try {
    const eco = await one("INSERT INTO ecos (company_id, number, title, description, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [co(req), number.trim(), title.trim(), description || "", req.ctx.user.id]);
    res.json({ eco });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "An ECO with that number already exists." });
    throw e;
  }
});

// attach an affected item revision (must be a working rev)
r.post("/ecos/:id/affected", requireRole("admin", "engineer"), async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "draft") return res.status(409).json({ error: "Affected items can only change while the ECO is a draft." });
  const rev = await one("SELECT * FROM item_revisions WHERE id=$1 AND company_id=$2", [req.body.revisionId, co(req)]);
  if (!rev) return res.status(404).json({ error: "Revision not found." });
  if (rev.status === "released") return res.status(409).json({ error: "That revision is already released." });
  const exists = await one("SELECT 1 FROM eco_affected WHERE eco_id=$1 AND item_revision_id=$2 AND company_id=$3", [eco.id, rev.id, co(req)]);
  if (exists) return res.status(409).json({ error: "Already on this ECO." });
  await query("INSERT INTO eco_affected (company_id, eco_id, item_revision_id) VALUES ($1,$2,$3)", [co(req), eco.id, rev.id]);
  res.json({ ok: true });
});

// ----- submit: draft -> in_review at step 1 -----
r.post("/ecos/:id/submit", requireRole("admin", "engineer"), async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "draft") return res.status(409).json({ error: "Only a draft ECO can be submitted." });
  const affected = await query("SELECT iv.id FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id WHERE a.eco_id=$1 AND a.company_id=$2", [eco.id, co(req)]);
  if (!affected.length) return res.status(400).json({ error: "Add at least one affected item before submitting." });
  const first = await one("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq LIMIT 1", [co(req)]);
  if (!first) return res.status(400).json({ error: "No approval workflow is configured. Ask an admin to set one up." });
  await query("UPDATE ecos SET status='in_review', current_seq=$1 WHERE id=$2 AND company_id=$3", [first.seq, eco.id, co(req)]);
  // mark affected revisions in_review
  await query("UPDATE item_revisions SET status='in_review' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='working'", [eco.id, co(req)]);
  res.json({ ok: true });
});

// ----- act on the current step: approve / reject (role must match the step) -----
r.post("/ecos/:id/decide", async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "in_review") return res.status(409).json({ error: "This ECO isn't awaiting a decision." });
  const step = await one("SELECT * FROM eco_workflow_steps WHERE company_id=$1 AND seq=$2", [co(req), eco.current_seq]);
  if (!step) return res.status(409).json({ error: "Workflow step not found." });
  // role gate: the acting user's role must match the step's role (admin can act on any step)
  if (req.ctx.user.role !== step.role && req.ctx.user.role !== "admin")
    return res.status(403).json({ error: `This step requires the "${step.role}" role.` });

  const decision = req.body.decision === "reject" ? "reject" : "approve";
  await query("INSERT INTO eco_approvals (company_id, eco_id, seq, decision, disposition, comment, approver_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [co(req), eco.id, eco.current_seq, decision, req.body.disposition || "", req.body.comment || "", req.ctx.user.id]);

  if (decision === "reject") {
    await query("UPDATE ecos SET status='rejected' WHERE id=$1 AND company_id=$2", [eco.id, co(req)]);
    // affected revisions return to working
    await query("UPDATE item_revisions SET status='working' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='in_review'", [eco.id, co(req)]);
    return res.json({ ok: true, result: "rejected" });
  }

  // approved this step — is there a next step?
  const next = await one("SELECT * FROM eco_workflow_steps WHERE company_id=$1 AND seq>$2 ORDER BY seq LIMIT 1", [co(req), eco.current_seq]);
  if (next) {
    await query("UPDATE ecos SET current_seq=$1 WHERE id=$2 AND company_id=$3", [next.seq, eco.id, co(req)]);
    return res.json({ ok: true, result: "advanced", nextStep: next.name });
  }

  // final approval -> implement -> RELEASE (lock) all affected revisions
  await query("UPDATE ecos SET status='implemented', current_seq=0 WHERE id=$1 AND company_id=$2", [eco.id, co(req)]);
  await query("UPDATE item_revisions SET status='released', released_at=now() WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2", [eco.id, co(req)]);
  res.json({ ok: true, result: "implemented" });
});

export default r;
