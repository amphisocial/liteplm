// src/lib/csv.js — small, correct CSV parser. Returns array of row objects keyed
// by the header row. Handles quoted fields, embedded commas/quotes, and CRLF.
export function parseCsv(text) {
  const s = String(text || "").replace(/^\uFEFF/, ""); // strip BOM
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const out = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const r = nonEmpty[i]; const o = {};
    headers.forEach((h, j) => { o[h] = (r[j] ?? "").trim(); });
    out.push(o);
  }
  return { headers, rows: out };
}
