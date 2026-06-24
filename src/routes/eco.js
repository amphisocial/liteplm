// src/routes/eco.js — engineering change orders with a full audit trail.
// Lifecycle: draft -> (submit) in_progress -> (final approval) released.
// Reject sends an in_progress ECO back to draft so it can be edited & resubmitted.
// Cycle time = released_at - submitted_at (first submit, preserved across resubmits).
// Every meaningful action is recorded in eco_events for the Audit tab.
import { Router } from "express";
import { query, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { diffBom } from "../lib/bomdiff.js";

const r = Router();
r.use(requireAuth);
const co = (req) => req.ctx.company_id;
const REASONS = ["supplier obsolescence", "design flaw", "cost reduction", "documentation", "other"];
const effectiveSteps = (allSteps, impactClass) => (impactClass === "Class 2" ? allSteps.slice(0, 1) : allSteps);

function logEvent(companyId, ecoId, type, ev = {}) {
  return query(
    "INSERT INTO eco_events (company_id, eco_id, type, seq, step_name, step_role, user_id, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [companyId, ecoId, type, ev.seq ?? null, ev.stepName ?? null, ev.stepRole ?? null, ev.userId ?? null, ev.comment ?? ""]);
}
const touchEco = (req, ecoId) => query("UPDATE ecos SET updated_at=now(), updated_by=$1 WHERE id=$2 AND company_id=$3", [req.ctx.user.id, ecoId, co(req)]);

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

// ----- list / detail -----
r.get("/ecos", async (req, res) => {
  res.json({ ecos: await query("SELECT * FROM ecos WHERE company_id=$1 ORDER BY id DESC", [co(req)]) });
});

r.get("/ecos/:id", async (req, res) => {
  const eco = await one(
    `SELECT e.*, cu.name AS created_by_name, uu.name AS updated_by_name
       FROM ecos e LEFT JOIN users cu ON cu.id=e.created_by LEFT JOIN users uu ON uu.id=e.updated_by
     WHERE e.id=$1 AND e.company_id=$2`, [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  const affected = await query(
    `SELECT a.id, a.item_revision_id, a.disposition, a.eff_date, a.eff_unit, a.eff_batch,
            iv.rev, iv.status, i.id AS item_id, i.number, i.name
       FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id JOIN items i ON i.id=iv.item_id
     WHERE a.eco_id=$1 AND a.company_id=$2 ORDER BY i.number`, [eco.id, co(req)]);
  const allSteps = await query("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq", [co(req)]);
  const steps = effectiveSteps(allSteps, eco.impact_class);
  const events = await query(
    "SELECT ev.*, u.name AS user_name FROM eco_events ev LEFT JOIN users u ON u.id=ev.user_id WHERE ev.eco_id=$1 AND ev.company_id=$2 ORDER BY ev.id", [eco.id, co(req)]);
  const pendingStep = steps.find((s) => s.seq === eco.current_seq) || null;
  res.json({ eco, affected, steps, allSteps, events, pendingStep, reasons: REASONS });
});

// ----- create / update a draft (Save) -----
async function attachAffected(companyId, ecoId, a) {
  const rev = await one("SELECT * FROM item_revisions WHERE id=$1 AND company_id=$2", [a.revisionId, companyId]);
  if (!rev) return { error: "Revision not found.", code: 404 };
  if (rev.status === "released") return { error: "That revision is already released.", code: 409 };
  const disp = ["Use As Is", "Rework", "Scrap"].includes(a.disposition) ? a.disposition : "Use As Is";
  await query(
    "INSERT INTO eco_affected (company_id, eco_id, item_revision_id, disposition, eff_date, eff_unit, eff_batch) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [companyId, ecoId, rev.id, disp, a.effDate || null, a.effUnit || "", a.effBatch || ""]);
  return { ok: true };
}

r.post("/ecos/draft", requireRole("admin", "engineer"), async (req, res) => {
  const { id, number, title, description, reason, impactClass, affected } = req.body || {};
  if (!number || !title) return res.status(400).json({ error: "ECO number and title are required." });
  const impact = impactClass === "Class 2" ? "Class 2" : "Class 1";
  const rsn = REASONS.includes(reason) ? reason : "other";
  const list = Array.isArray(affected) ? affected : [];

  let eco;
  if (id) {
    eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [id, co(req)]);
    if (!eco) return res.status(404).json({ error: "ECO not found." });
    if (eco.status !== "draft") return res.status(409).json({ error: "Only a draft ECO can be edited." });
    await query("UPDATE ecos SET number=$1, title=$2, description=$3, reason=$4, impact_class=$5, updated_at=now(), updated_by=$6 WHERE id=$7 AND company_id=$8",
      [number.trim(), title.trim(), description || "", rsn, impact, req.ctx.user.id, eco.id, co(req)]).catch((e) => { throw e; });
    await query("DELETE FROM eco_affected WHERE eco_id=$1 AND company_id=$2", [eco.id, co(req)]);
    await logEvent(co(req), eco.id, "edited", { userId: req.ctx.user.id });
  } else {
    try {
      eco = await one(
        "INSERT INTO ecos (company_id, number, title, description, reason, impact_class, status, current_seq, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',0,$7,$7) RETURNING *",
        [co(req), number.trim(), title.trim(), description || "", rsn, impact, req.ctx.user.id]);
    } catch (e) {
      if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "An ECO with that number already exists." });
      throw e;
    }
    await logEvent(co(req), eco.id, "created", { userId: req.ctx.user.id });
  }
  for (const a of list) {
    const r2 = await attachAffected(co(req), eco.id, a);
    if (r2.error) return res.status(r2.code).json({ error: r2.error });
  }
  res.json({ eco: await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [eco.id, co(req)]) });
});

// ----- submit a draft (cycle-time starts on first submit) -----
async function doSubmit(req, eco) {
  const affected = await query("SELECT iv.id FROM eco_affected a JOIN item_revisions iv ON iv.id=a.item_revision_id WHERE a.eco_id=$1 AND a.company_id=$2", [eco.id, co(req)]);
  if (!affected.length) return { error: "Add at least one affected item before submitting.", code: 400 };
  const first = await one("SELECT * FROM eco_workflow_steps WHERE company_id=$1 ORDER BY seq LIMIT 1", [co(req)]);
  if (!first) return { error: "No approval workflow is configured. Ask an admin to set one up.", code: 400 };
  const isResubmit = !!eco.submitted_at;
  await query(
    `UPDATE ecos SET status='in_progress', current_seq=$1, updated_at=now(), updated_by=$2 ${isResubmit ? "" : ", submitted_at=now()"} WHERE id=$3 AND company_id=$4`,
    [first.seq, req.ctx.user.id, eco.id, co(req)]);
  await query("UPDATE item_revisions SET status='in_review' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='working'", [eco.id, co(req)]);
  await logEvent(co(req), eco.id, isResubmit ? "resubmitted" : "submitted", { userId: req.ctx.user.id });
  return { ok: true };
}

r.post("/ecos/:id/submit", requireRole("admin", "engineer"), async (req, res) => {
  const eco = await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!eco) return res.status(404).json({ error: "ECO not found." });
  if (eco.status !== "draft") return res.status(409).json({ error: "Only a draft ECO can be submitted." });
  const r2 = await doSubmit(req, eco);
  if (r2.error) return res.status(r2.code).json({ error: r2.error });
  res.json({ ok: true });
});

// ----- one-shot release (create + attach + submit) -----
r.post("/ecos/release", requireRole("admin", "engineer"), async (req, res) => {
  const { number, title, description, reason, impactClass, affected } = req.body || {};
  if (!number || !title) return res.status(400).json({ error: "ECO number and title are required." });
  if (!Array.isArray(affected) || !affected.length) return res.status(400).json({ error: "Add at least one working revision to release." });
  const impact = impactClass === "Class 2" ? "Class 2" : "Class 1";
  let eco;
  try {
    eco = await one(
      "INSERT INTO ecos (company_id, number, title, description, reason, impact_class, status, current_seq, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',0,$7,$7) RETURNING *",
      [co(req), number.trim(), title.trim(), description || "", REASONS.includes(reason) ? reason : "other", impact, req.ctx.user.id]);
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "An ECO with that number already exists." });
    throw e;
  }
  await logEvent(co(req), eco.id, "created", { userId: req.ctx.user.id });
  for (const a of affected) {
    const r2 = await attachAffected(co(req), eco.id, a);
    if (r2.error) { await query("DELETE FROM eco_affected WHERE eco_id=$1", [eco.id]); await query("DELETE FROM eco_events WHERE eco_id=$1", [eco.id]); await query("DELETE FROM ecos WHERE id=$1", [eco.id]); return res.status(r2.code).json({ error: r2.error }); }
  }
  const r3 = await doSubmit(req, eco);
  if (r3.error) return res.status(r3.code).json({ error: r3.error });
  res.json({ eco: await one("SELECT * FROM ecos WHERE id=$1 AND company_id=$2", [eco.id, co(req)]) });
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
  // role gate — only the step's role (or an admin) may act
  if (req.ctx.user.role !== step.role && req.ctx.user.role !== "admin")
    return res.status(403).json({ error: `This step requires the "${step.role}" role. Your role is "${req.ctx.user.role}".` });

  const decision = req.body.decision === "reject" ? "reject" : "approve";
  const comment = req.body.comment || "";

  if (decision === "reject") {
    await logEvent(co(req), eco.id, "rejected", { seq: step.seq, stepName: step.name, stepRole: step.role, userId: req.ctx.user.id, comment });
    await query("UPDATE ecos SET status='draft', current_seq=0, updated_at=now(), updated_by=$1 WHERE id=$2 AND company_id=$3", [req.ctx.user.id, eco.id, co(req)]);
    await query("UPDATE item_revisions SET status='working' WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2 AND status='in_review'", [eco.id, co(req)]);
    return res.json({ ok: true, result: "rejected" });
  }

  await logEvent(co(req), eco.id, "approved", { seq: step.seq, stepName: step.name, stepRole: step.role, userId: req.ctx.user.id, comment });
  const next = steps.find((s) => s.seq > eco.current_seq);
  if (next) {
    await query("UPDATE ecos SET current_seq=$1, updated_at=now(), updated_by=$2 WHERE id=$3 AND company_id=$4", [next.seq, req.ctx.user.id, eco.id, co(req)]);
    return res.json({ ok: true, result: "advanced", nextStep: next.name });
  }
  // final required step approved -> release
  await query("UPDATE ecos SET status='released', current_seq=0, released_at=now(), updated_at=now(), updated_by=$1 WHERE id=$2 AND company_id=$3", [req.ctx.user.id, eco.id, co(req)]);
  await query("UPDATE item_revisions SET status='released', released_at=now() WHERE id IN (SELECT item_revision_id FROM eco_affected WHERE eco_id=$1) AND company_id=$2", [eco.id, co(req)]);
  await logEvent(co(req), eco.id, "released", { userId: req.ctx.user.id });
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
