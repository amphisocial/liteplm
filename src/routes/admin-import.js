// src/routes/admin-import.js — admin-only CSV import (wipe & reseed).
// Imports reference each other by natural key (part number, vendor code, rev),
// so the five files form a coherent dataset. Runs in one transaction; on any
// error nothing is committed.
import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { parseCsv } from "../lib/csv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = Router();
r.use(requireAuth, requireRole("admin"));

// chunked multi-row insert; returns nothing, throws on error
async function bulkInsert(client, table, cols, rows, build) {
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of slice) {
      const vals = build(row);
      if (!vals) continue;
      values.push("(" + vals.map(() => "$" + p++).join(",") + ")");
      params.push(...vals);
    }
    if (!values.length) continue;
    await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values.join(",")}`, params);
  }
}

async function runImport(companyId, files) {
  const items = parseCsv(files.items || "").rows;
  const revisions = parseCsv(files.revisions || "").rows;
  const boms = parseCsv(files.boms || "").rows;
  const vendors = parseCsv(files.vendors || "").rows;
  const vendorParts = parseCsv(files.vendorParts || "").rows;
  if (!items.length) throw new Error("items.csv is required and must have rows (number,name,description,uom).");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // wipe this company's business data (keep users, sessions, tokens, workflow)
    for (const t of ["eco_approvals", "eco_affected", "ecos", "bom_lines", "vendor_parts", "vendors", "item_revisions", "items"]) {
      await client.query(`DELETE FROM ${t} WHERE company_id=$1`, [companyId]);
    }

    // items
    await bulkInsert(client, "items", ["company_id", "number", "name", "description", "uom"], items, (x) => {
      if (!x.number || !x.name) return null;
      return [companyId, x.number.trim(), x.name.trim(), x.description || "", (x.uom || "EA").trim()];
    });
    const itemRows = (await client.query("SELECT id, number FROM items WHERE company_id=$1", [companyId])).rows;
    const itemByNum = new Map(itemRows.map((i) => [i.number, i.id]));

    // revisions — if none supplied, give every item a working rev A
    let revSource = revisions;
    if (!revSource.length) revSource = itemRows.map((i) => ({ item_number: i.number, rev: "A", status: "working" }));
    await bulkInsert(client, "item_revisions", ["company_id", "item_id", "rev", "status", "lifecycle", "part_type", "released_at"], revSource, (x) => {
      const id = itemByNum.get((x.item_number || "").trim());
      if (!id || !x.rev) return null;
      const status = ["working", "in_review", "released", "obsolete"].includes(x.status) ? x.status : "working";
      const life = ["Prototype", "Preproduction", "Production"].includes(x.lifecycle) ? x.lifecycle : "Production";
      const ptype = x.part_type === "Buy" ? "Buy" : "Make";
      const released = status === "released" ? new Date() : null;
      return [companyId, id, x.rev.trim(), status, life, ptype, released];
    });
    const revRows = (await client.query(
      "SELECT iv.id, iv.rev, iv.item_id, i.number FROM item_revisions iv JOIN items i ON i.id=iv.item_id WHERE iv.company_id=$1 ORDER BY iv.id", [companyId]
    )).rows;
    const revByKey = new Map(revRows.map((v) => [v.number + "||" + v.rev, v.id]));
    const latestRevByItem = new Map();
    for (const v of revRows) latestRevByItem.set(v.number, v.id); // ordered by id => last wins = latest

    // vendors
    await bulkInsert(client, "vendors", ["company_id", "code", "name", "contact"], vendors, (x) => {
      if (!x.code || !x.name) return null;
      return [companyId, x.code.trim(), x.name.trim(), x.contact || ""];
    });
    const vendorRows = (await client.query("SELECT id, code FROM vendors WHERE company_id=$1", [companyId])).rows;
    const vendorByCode = new Map(vendorRows.map((v) => [v.code, v.id]));

    // vendor parts (revision-scoped: item_rev column, falls back to latest rev)
    await bulkInsert(client, "vendor_parts", ["company_id", "vendor_id", "item_id", "item_revision_id", "vendor_part_number", "price"], vendorParts, (x) => {
      const vid = vendorByCode.get((x.vendor_code || "").trim());
      const num = (x.item_number || "").trim();
      const iid = itemByNum.get(num);
      if (!vid || !iid) return null;
      const rid = revByKey.get(num + "||" + (x.item_rev || "").trim()) || latestRevByItem.get(num) || null;
      return [companyId, vid, iid, rid, (x.vendor_part_number || "").trim(), Number(x.price) || 0];
    });

    // bom lines (parent rev + child item + the child's specific rev)
    await bulkInsert(client, "bom_lines", ["company_id", "parent_rev_id", "child_item_id", "child_rev_id", "qty", "ref_des"], boms, (x) => {
      const pr = revByKey.get((x.parent_number || "").trim() + "||" + (x.parent_rev || "").trim());
      const childNum = (x.child_number || "").trim();
      const ci = itemByNum.get(childNum);
      if (!pr || !ci) return null;
      const cr = revByKey.get(childNum + "||" + (x.child_rev || "").trim()) || latestRevByItem.get(childNum) || null;
      return [companyId, pr, ci, cr, Number(x.qty) || 1, x.ref_des || ""];
    });

    await client.query("COMMIT");

    const count = async (t) => (await pool.query(`SELECT count(*)::int n FROM ${t} WHERE company_id=$1`, [companyId])).rows[0].n;
    return {
      items: await count("items"), revisions: await count("item_revisions"),
      bomLines: await count("bom_lines"), vendors: await count("vendors"), vendorParts: await count("vendor_parts"),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// upload your own CSVs (text in the body)
r.post("/import", async (req, res) => {
  try { res.json({ ok: true, counts: await runImport(req.ctx.company_id, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// one-click load the bundled sample dataset
r.post("/import/sample", async (req, res) => {
  try {
    const dir = join(__dirname, "..", "..", "db", "samples", "medical");
    const read = (f) => readFileSync(join(dir, f), "utf8");
    const counts = await runImport(req.ctx.company_id, {
      items: read("items.csv"), revisions: read("revisions.csv"), boms: read("boms.csv"),
      vendors: read("vendors.csv"), vendorParts: read("vendor_parts.csv"),
    });
    res.json({ ok: true, counts, dataset: "medical" });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default r;
