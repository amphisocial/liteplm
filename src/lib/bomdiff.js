// src/lib/bomdiff.js — compare two BOMs (lists of lines) and produce a redline.
// Lines are matched by child_item_id. Output entries:
//   { type:'add'|'delete', child_number, child_name, qty, child_rev }
//   { type:'update', child_number, child_name, changes:[{field, from, to}] }
export function diffBom(fromLines, toLines) {
  const fromMap = new Map(fromLines.map((l) => [l.child_item_id, l]));
  const toMap = new Map(toLines.map((l) => [l.child_item_id, l]));
  const out = [];
  for (const [k, t] of toMap) {
    const fr = fromMap.get(k);
    if (!fr) { out.push({ type: "add", child_number: t.child_number, child_name: t.child_name, qty: t.qty, child_rev: t.child_rev }); continue; }
    const changes = [];
    if (String(fr.qty) !== String(t.qty)) changes.push({ field: "Qty", from: fr.qty, to: t.qty });
    if ((fr.ref_des || "") !== (t.ref_des || "")) changes.push({ field: "Ref des", from: fr.ref_des || "—", to: t.ref_des || "—" });
    if (changes.length) out.push({ type: "update", child_number: t.child_number, child_name: t.child_name, changes });
  }
  for (const [k, fr] of fromMap) {
    if (!toMap.has(k)) out.push({ type: "delete", child_number: fr.child_number, child_name: fr.child_name, qty: fr.qty, child_rev: fr.child_rev });
  }
  const order = { add: 0, update: 1, delete: 2 };
  out.sort((a, b) => order[a.type] - order[b.type] || String(a.child_number).localeCompare(String(b.child_number)));
  return out;
}
