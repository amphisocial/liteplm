// src/routes/eco.js — engineering change orders.
// Flow: working revisions are gathered onto an ECO (Release → ECO), the ECO is
// submitted (status "in_progress") and walks the approval chain. Class 1 (major)
// runs every workflow step; Class 2 (minor) runs only the first step. When the
// final required step is approved the ECO becomes "released" and every affected
// revision is released (locked).
import { Router } from "express";
import { query, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { diffBom } from "../lib/bomdiff.js";

const r = Router();
r.use(requireAuth);
const co = (req) => req.ctx.company_id;
const REASONS = ["supplier obsolescence", "design flaw", "cost reduction", "documentation", "other"];

function effectiveSteps(allSteps, impactClass) {
  return impactClass === "Class 2" ? allSteps.slice(0, 1) : allSteps;
}

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
    `SELECT a.id, a.item_revision_id, a.disposition, a.eff_date, a.eff_unit, a.eff_batch,
            iv.rev, iv.status, i.id AS item_id, i.number, i.name
       FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id JOIN items i ON i.id=iv.item_id
     WHERE a.eco_id=$1 AND a.company_id=$2 ORDER BY i.number`, [eco.id, co(req)]);
  const allSteps = await query("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq", [co(req)]);
  const steps = effectiveSteps(allSteps, eco.impact_class);
  const approvals = await query(
    "SELECT ea.*, u.name AS approver_name FROM eco_approvals ea LEFT JOIN users u ON u.id=ea.approver_id WHERE ea.eco_id=$1 AND ea.company_id=$2 ORDER BY ea.seq",
    [eco.id, co(req)]);
  const pendingStep = steps.find((s) => s.seq === eco.current_seq) || null;
  res.json({ eco, affected, steps, allSteps, approvals, pendingStep, reasons: REASONS });
});

// ----- create ECO (draft) -----
r.post("/ecos", requireRole("admin", "engineer"), async (req, res) => {
  const { number, title, description, reason, impactClass } = req.body || {};
  if (!number || !title) return res.status(400).json({ error: "ECO number and title are required." });
  const impact = impactClass === "Class 2" ? "Class 2" : "Class 1";
  try {
    const eco = await one(
      "INSERT INTO ecos (company_id, number, title, description, reason, impact_class, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [co(req), number.trim(), title.trim(), description || "", REASONS.includes(reason) ? reason : "other", impact, req.ctx.user.id]);
    res.json({ eco });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "An ECO with that number already exists." });
    throw e;
  }
});

async function attachAffected(companyId, ecoId, a) {
  const rev = await one("SELECT * FROM item_revisions WHERE id=$1 AND company_id=$2", [a.revisionId, companyId]);
  if (!rev) return { error: "Revision not found.", code: 404 };
  if (rev.status === "released") return { error: "That revision is already released.", code: 409 };
  const exists = await one("SELECT 1 FROM eco_affected WHERE eco_id=$1 AND item_revision_id=$2 AND company_id=$3", [ecoId, rev.id, companyId]);
  if (exists) return { ok: true };
  const disp = ["Use As Is", "Rework", "Scrap"].includes(a.disposition) ? a.disposition : "Use As Is";
  const effDate = a.effDate ? a.effDate : null;
  await query(
    "INSERT INTO eco_affected (company_id, eco_id, item_revision_id, disposition, eff_date, eff_unit, eff_batch) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [companyId, ecoId, rev.id, disp, effDate, a.effUnit || "", a.effBatch || ""]);
  return { ok: true };
}

r.post("/ecos/:id/affected", requireRole("admin", "engineer"), async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "draft") return res.status(409).json({ error: "Affected items can only change while the ECO is a draft." });
  const r2 = await attachAffected(co(req), eco.id, req.body || {});
  if (r2.error) return res.status(r2.code).json({ error: r2.error });
  res.json({ ok: true });
});

// ----- one-shot: create + attach all + submit (Release → ECO form) -----
r.post("/ecos/release", requireRole("admin", "engineer"), async (req, res) => {
  const { number, title, description, reason, impactClass, affected } = req.body || {};
  if (!number || !title) return res.status(400).json({ error: "ECO number and title are required." });
  if (!Array.isArray(affected) || !affected.length) return res.status(400).json({ error: "Add at least one working revision to release." });
  const impact = impactClass === "Class 2" ? "Class 2" : "Class 1";
  const first = await one("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq LIMIT 1", [co(req)]);
  if (!first) return res.status(400).json({ error: "No approval workflow is configured. Ask an admin to set one up." });

  let eco;
  try {
    eco = await one(
      "INSERT INTO ecos (company_id, number, title, description, reason, impact_class, status, current_seq, created_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',0,$7) RETURNING *",
      [co(req), number.trim(), title.trim(), description || "", REASONS.includes(reason) ? reason : "other", impact, req.ctx.user.id]);
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "An ECO with that number already exists." });
    throw e;
  }
  for (const a of affected) {
    const r2 = await attachAffected(co(req), eco.id, a);
    if (r2.error) { await query("DELETE FROM eco_affected WHERE eco_id=$1", [eco.id]); await query("DELETE FROM ecos WHERE id=$1", [eco.id]); return res.status(r2.code).json({ error: r2.error }); }
  }
  await query("UPDATE ecos SET status='in_progress', current_seq=$1 WHERE id=$2 AND company_id=$3", [first.seq, eco.id, co(req)]);
  await query("UPDATE item_revisions SET status='in_review' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='working'", [eco.id, co(req)]);
  res.json({ eco: { ...eco, status: "in_progress", current_seq: first.seq } });
});

// ----- submit an existing draft -----
r.post("/ecos/:id/submit", requireRole("admin", "engineer"), async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "draft") return res.status(409).json({ error: "Only a draft ECO can be submitted." });
  const affected = await query("SELECT iv.id FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id WHERE a.eco_id=$1 AND a.company_id=$2", [eco.id, co(req)]);
  if (!affected.length) return res.status(400).json({ error: "Add at least one affected item before submitting." });
  const first = await one("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq LIMIT 1", [co(req)]);
  if (!first) return res.status(400).json({ error: "No approval workflow is configured. Ask an admin to set one up." });
  await query("UPDATE ecos SET status='in_progress', current_seq=$1 WHERE id=$2 AND company_id=$3", [first.seq, eco.id, co(req)]);
  await query("UPDATE item_revisions SET status='in_review' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='working'", [eco.id, co(req)]);
  res.json({ ok: true });
});

// ----- approve / reject the current step -----
r.post("/ecos/:id/decide", async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "in_progress") return res.status(409).json({ error: "This ECO isn't awaiting a decision." });
  const allSteps = await query("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq", [co(req)]);
  const steps = effectiveSteps(allSteps, eco.impact_class);
  const step = steps.find((s) => s.seq === eco.current_seq);
  if (!step) return res.status(409).json({ error: "Workflow step not found." });
  if (req.ctx.user.role !== step.role && req.ctx.user.role !== "admin")
    return res.status(403).json({ error: `This step requires the "${step.role}" role.` });

  const decision = req.body.decision === "reject" ? "reject" : "approve";
  await query("INSERT INTO eco_approvals (company_id, eco_id, seq, decision, disposition, comment, approver_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [co(req), eco.id, eco.current_seq, decision, req.body.disposition || "", req.body.comment || "", req.ctx.user.id]);

  if (decision === "reject") {
    await query("UPDATE ecos SET status='rejected' WHERE id=$1 AND company_id=$2", [eco.id, co(req)]);
    await query("UPDATE item_revisions SET status='working' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='in_review'", [eco.id, co(req)]);
    return res.json({ ok: true, result: "rejected" });
  }

  const next = steps.find((s) => s.seq > eco.current_seq);
  if (next) {
    await query("UPDATE ecos SET current_seq=$1 WHERE id=$2 AND company_id=$3", [next.seq, eco.id, co(req)]);
    return res.json({ ok: true, result: "advanced", nextStep: next.name });
  }

  await query("UPDATE ecos SET status='released', current_seq=0 WHERE id=$1 AND company_id=$2", [eco.id, co(req)]);
  await query("UPDATE item_revisions SET status='released', released_at=now() WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2", [eco.id, co(req)]);
  res.json({ ok: true, result: "released" });
});

// ECO compare: each affected (To) revision vs its latest released predecessor (From).
r.get("/ecos/:id/compare", async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  const toRevs = await query(
    `SELECT iv.id, iv.rev, iv.item_id, i.number, i.name
       FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id JOIN items i ON i.id=iv.item_id
     WHERE a.eco_id=$1 AND a.company_id=$2 ORDER BY i.number`, [eco.id, co(req)]);
  const linesOf = (revId) => query(
    `SELECT b.qty, b.ref_des, b.child_item_id, ci.number AS child_number, ci.name AS child_name, cv.rev AS child_rev
       FROM bom_lines b JOIN items ci ON ci.id=b.child_item_id LEFT JOIN item_revisions cv ON cv.id=b.child_rev_id
     WHERE b.parent_rev_id=$1 AND b.company_id=$2`, [revId, co(req)]);
  const out = [];
  for (const to of toRevs) {
    const from = await one(
      "SELECT id, rev FROM item_revisions WHERE item_id=$1 AND company_id=$2 AND status='released' AND id<$3 ORDER BY id DESC LIMIT 1",
      [to.item_id, co(req), to.id]);
    const toLines = await linesOf(to.id);
    const fromLines = from ? await linesOf(from.id) : [];
    out.push({ number: to.number, name: to.name, fromRev: from ? from.rev : null, toRev: to.rev, diff: diffBom(fromLines, toLines) });
  }
  res.json({ eco: { number: eco.number, title: eco.title }, comparisons: out });
});

export default r;
