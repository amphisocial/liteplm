// src/routes/catalog.js — items, revisions, BOMs, vendors, search.
import { Router } from "express";
import { query, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { nlToFilter, aiEnabled } from "../lib/ai.js";

const r = Router();
r.use(requireAuth);
const co = (req) => req.ctx.company_id;
const canEdit = (req) => ["admin", "engineer"].includes(req.ctx.user.role);

// ---------- ITEMS ----------
r.get("/items", async (req, res) => {
  const rows = await query(
    `SELECT i.*, (SELECT rev FROM item_revisions v WHERE v.item_id=i.id AND v.company_id=i.company_id ORDER BY v.id DESC LIMIT 1) AS latest_rev,
            (SELECT status FROM item_revisions v WHERE v.item_id=i.id AND v.company_id=i.company_id ORDER BY v.id DESC LIMIT 1) AS latest_status
     FROM items i WHERE i.company_id=$1 ORDER BY i.number`, [co(req)]);
  res.json({ items: rows });
});

r.post("/items", async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: "Only admins and engineers can create items." });
  const { number, name, description, uom } = req.body || {};
  if (!number || !name) return res.status(400).json({ error: "Item number and name are required." });
  try {
    const item = await one("INSERT INTO items (company_id, number, name, description, uom) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [co(req), number.trim(), name.trim(), description || "", uom || "EA"]);
    await one("INSERT INTO item_revisions (company_id, item_id, rev, status) VALUES ($1,$2,'A','working') RETURNING *", [co(req), item.id]);
    res.json({ item });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "An item with that number already exists." });
    throw e;
  }
});

r.get("/items/:id", async (req, res) => {
  const item = await one("SELECT * FROM items WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!item) return res.status(404).json({ error: "Item not found." });
  const revs = await query("SELECT * FROM item_revisions WHERE item_id=$1 AND company_id=$2 ORDER BY id", [item.id, co(req)]);
  res.json({ item, revisions: revs });
});

// Everything that is focused on ONE revision: its BOM, where it is used, its vendor parts.
r.get("/revisions/:revId/focus", async (req, res) => {
  const rev = await one(
    "SELECT iv.*, i.number, i.name, i.description, i.uom FROM item_revisions iv JOIN items i ON i.id=iv.item_id WHERE iv.id=$1 AND iv.company_id=$2",
    [req.params.revId, co(req)]);
  if (!rev) return res.status(404).json({ error: "Revision not found." });
  const bom = await query(
    `SELECT b.*, ci.number AS child_number, ci.name AS child_name, ci.uom AS child_uom, cv.rev AS child_rev
       FROM bom_lines b JOIN items ci ON ci.id=b.child_item_id
       LEFT JOIN item_revisions cv ON cv.id=b.child_rev_id
     WHERE b.parent_rev_id=$1 AND b.company_id=$2 ORDER BY b.id`, [rev.id, co(req)]);
  // where used: parents whose BOM references THIS revision specifically
  const whereUsed = await query(
    `SELECT DISTINCT pi.id AS item_id, pi.number, pi.name, pr.rev AS parent_rev, pr.id AS parent_rev_id, b.qty
       FROM bom_lines b JOIN item_revisions pr ON pr.id=b.parent_rev_id JOIN items pi ON pi.id=pr.item_id
     WHERE b.child_rev_id=$1 AND b.company_id=$2 ORDER BY pi.number`, [rev.id, co(req)]);
  const vendorParts = await query(
    `SELECT vp.*, v.name AS vendor_name, v.code AS vendor_code, v.contact AS vendor_contact
       FROM vendor_parts vp JOIN vendors v ON v.id=vp.vendor_id
     WHERE vp.item_revision_id=$1 AND vp.company_id=$2 ORDER BY v.code`, [rev.id, co(req)]);
  res.json({ revision: rev, bom, whereUsed, vendorParts });
});

// Revise: create a new WORKING copy from the latest released/working rev (next letter).
r.post("/items/:id/revise", async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: "Only admins and engineers can revise items." });
  const item = await one("SELECT * FROM items WHERE id=$1 AND company_id=$2", [req.params.id, co(req)]);
  if (!item) return res.status(404).json({ error: "Item not found." });
  const last = await one("SELECT * FROM item_revisions WHERE item_id=$1 AND company_id=$2 ORDER BY id DESC LIMIT 1", [item.id, co(req)]);
  if (last && last.status === "working") return res.status(409).json({ error: `Rev ${last.rev} is still working — release it before creating a new revision.` });
  const nextRev = last ? String.fromCharCode(last.rev.charCodeAt(0) + 1) : "A";
  const rev = await one("INSERT INTO item_revisions (company_id, item_id, rev, status) VALUES ($1,$2,$3,'working') RETURNING *", [co(req), item.id, nextRev]);
  // carry the BOM forward into the new working rev
  if (last) {
    await query(`INSERT INTO bom_lines (company_id, parent_rev_id, child_item_id, child_rev_id, qty, ref_des)
                 SELECT company_id, $1, child_item_id, child_rev_id, qty, ref_des FROM bom_lines WHERE parent_rev_id=$2 AND company_id=$3`,
      [rev.id, last.id, co(req)]);
  }
  res.json({ revision: rev });
});

// ---------- BOM ----------
r.get("/revisions/:revId/bom", async (req, res) => {
  const rev = await one("SELECT * FROM item_revisions WHERE id=$1 AND company_id=$2", [req.params.revId, co(req)]);
  if (!rev) return res.status(404).json({ error: "Revision not found." });
  const lines = await query(
    `SELECT b.*, ci.number AS child_number, ci.name AS child_name, ci.uom AS child_uom
       FROM bom_lines b JOIN items ci ON ci.id=b.child_item_id
     WHERE b.parent_rev_id=$1 AND b.company_id=$2 ORDER BY b.id`, [rev.id, co(req)]);
  res.json({ revision: rev, lines });
});

r.post("/revisions/:revId/bom", async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: "Only admins and engineers can edit BOMs." });
  const rev = await one("SELECT * FROM item_revisions WHERE id=$1 AND company_id=$2", [req.params.revId, co(req)]);
  if (!rev) return res.status(404).json({ error: "Revision not found." });
  if (rev.status === "released") return res.status(409).json({ error: "This revision is released and locked. Revise the item to make changes." });
  const { childNumber, qty, refDes } = req.body || {};
  const child = await one("SELECT * FROM items WHERE number=$1 AND company_id=$2", [String(childNumber || "").trim(), co(req)]);
  if (!child) return res.status(404).json({ error: `No item with number "${childNumber}".` });
  if (child.id === rev.item_id) return res.status(400).json({ error: "An item can't contain itself." });
  const childRev = await one("SELECT id FROM item_revisions WHERE item_id=$1 AND company_id=$2 ORDER BY id DESC LIMIT 1", [child.id, co(req)]);
  const line = await one("INSERT INTO bom_lines (company_id, parent_rev_id, child_item_id, child_rev_id, qty, ref_des) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [co(req), rev.id, child.id, childRev ? childRev.id : null, Number(qty) || 1, refDes || ""]);
  res.json({ line });
});

r.delete("/bom/:lineId", async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: "Only admins and engineers can edit BOMs." });
  const line = await one(`SELECT b.*, v.status FROM bom_lines b JOIN item_revisions v ON v.id=b.parent_rev_id WHERE b.id=$1 AND b.company_id=$2`, [req.params.lineId, co(req)]);
  if (!line) return res.status(404).json({ error: "Line not found." });
  if (line.status === "released") return res.status(409).json({ error: "Released revision is locked." });
  await query("DELETE FROM bom_lines WHERE id=$1 AND company_id=$2", [req.params.lineId, co(req)]);
  res.json({ ok: true });
});

// ---------- VENDORS ----------
r.get("/vendors", async (req, res) => {
  res.json({ vendors: await query("SELECT * FROM vendors WHERE company_id=$1 ORDER BY code", [co(req)]) });
});
r.post("/vendors", async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: "Only admins and engineers can add vendors." });
  const { code, name, contact } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: "Vendor code and name are required." });
  try {
    res.json({ vendor: await one("INSERT INTO vendors (company_id, code, name, contact) VALUES ($1,$2,$3,$4) RETURNING *", [co(req), code.trim(), name.trim(), contact || ""]) });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "A vendor with that code already exists." });
    throw e;
  }
});
r.post("/vendor-parts", async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: "Only admins and engineers can link vendor parts." });
  const { vendorId, itemNumber, vendorPartNumber, price } = req.body || {};
  const item = await one("SELECT * FROM items WHERE number=$1 AND company_id=$2", [String(itemNumber || "").trim(), co(req)]);
  if (!item) return res.status(404).json({ error: `No item with number "${itemNumber}".` });
  const vendor = await one("SELECT * FROM vendors WHERE id=$1 AND company_id=$2", [vendorId, co(req)]);
  if (!vendor) return res.status(404).json({ error: "Vendor not found." });
  const rev = await one("SELECT id FROM item_revisions WHERE item_id=$1 AND company_id=$2 ORDER BY id DESC LIMIT 1", [item.id, co(req)]);
  res.json({ vendorPart: await one(
    "INSERT INTO vendor_parts (company_id, vendor_id, item_id, item_revision_id, vendor_part_number, price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [co(req), vendor.id, item.id, rev ? rev.id : null, String(vendorPartNumber || "").trim(), Number(price) || 0]) });
});

// ---------- SEARCH (AI natural language -> filter -> SQL, keyword fallback) ----------
r.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ results: [], entity: "items", mode: "empty", aiEnabled: aiEnabled() });
  const f = await nlToFilter(q);
  const like = "%" + (f.text || q).replace(/[%_]/g, "").trim() + "%";
  if (f.entity === "vendors") {
    const rows = await query("SELECT * FROM vendors WHERE company_id=$1 AND (name ILIKE $2 OR code ILIKE $2 OR contact ILIKE $2) ORDER BY code LIMIT 50", [co(req), like]);
    return res.json({ results: rows, entity: "vendors", mode: f._mode, aiEnabled: aiEnabled() });
  }
  const params = [co(req), like];
  let sql = `SELECT i.*, (SELECT status FROM item_revisions v WHERE v.item_id=i.id AND v.company_id=i.company_id ORDER BY v.id DESC LIMIT 1) AS latest_status
             FROM items i WHERE i.company_id=$1 AND (i.number ILIKE $2 OR i.name ILIKE $2 OR i.description ILIKE $2)`;
  if (f.uom) { params.push(f.uom); sql += ` AND i.uom=$${params.length}`; }
  if (f.status) { params.push(f.status); sql += ` AND EXISTS (SELECT 1 FROM item_revisions v WHERE v.item_id=i.id AND v.company_id=i.company_id AND v.status=$${params.length})`; }
  sql += " ORDER BY i.number LIMIT 50";
  res.json({ results: await query(sql, params), entity: "items", mode: f._mode, aiEnabled: aiEnabled() });
});

export default r;
