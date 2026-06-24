// js/app.js — Lite-PLM SPA (vanilla, no build step).
const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
let ME = null, META = { aiEnabled: false };

async function api(path, opts = {}) {
  const r = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(s).replace("_", " ")}</span>`;
const canEdit = () => ["admin", "engineer"].includes(ME.role);
const isAdmin = () => ME.role === "admin";
const fmt = (n) => Number(n).toLocaleString();

const ICON = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  items: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>',
  eco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>',
  vendors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.3a2 2 0 0 0-.6-1.4L18 9h-4v8h2"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  workflow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a3 3 0 0 0 3 3h6"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/></svg>',
  api: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3"/><path d="M17 22v-6M14 19l3 3 3-3"/></svg>',
};

async function api2(path) { try { return await api(path); } catch { return null; } }

// type (Make/Buy) + lifecycle badge helpers
const WRENCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.2-.4-.4-2.2 2.6-2.6z"/></svg>';
const CART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.4a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L22 7H6"/></svg>';
const typeBadge = (t) => t === "Buy"
  ? `<span class="tb tb-buy">${CART}Buy</span>`
  : `<span class="tb tb-make">${WRENCH}Make</span>`;
const lifeBadge = (l) => l ? `<span class="lc lc-${esc(l)}">${esc(l)}</span>` : "";

(async function boot() {
  META = (await api2("/meta")) || META;
  const m = await api2("/me");
  if (m && m.user) { ME = m.user; renderApp("dashboard"); } else renderAuth();
})();

// ---------------- auth ----------------
function renderAuth(mode = "login") {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="brandrow"><div class="logo">${ICON.items}</div><h1>Lite-PLM</h1></div>
    <div class="sub">${mode === "signup" ? "Create your company workspace." : "Sign in to your workspace."}</div>
    <div id="msg"></div>
    ${mode === "signup" ? `
      <div class="field"><label>Company name</label><input id="company" placeholder="Northbridge Medical"></div>
      <div class="field"><label>Your name</label><input id="name" placeholder="Jordan Lee"></div>` : ""}
    <div class="field"><label>Email</label><input id="email" type="email" placeholder="you@company.com"></div>
    <div class="field"><label>Password</label><input id="password" type="password" placeholder="••••••••"></div>
    <button class="btn block" id="go">${mode === "signup" ? "Create workspace" : "Sign in"}</button>
    <div class="swap">${mode === "signup" ? `Already have a workspace? <a id="swap">Sign in</a>` : `New here? <a id="swap">Create a workspace</a>`}</div>
  </div></div>`;
  $("#swap").onclick = () => renderAuth(mode === "signup" ? "login" : "signup");
  const submit = async () => {
    const body = { email: $("#email").value.trim(), password: $("#password").value };
    if (mode === "signup") { body.company = $("#company").value.trim(); body.name = $("#name").value.trim(); }
    $("#go").disabled = true;
    try { const res = await api("/" + (mode === "signup" ? "signup" : "login"), { method: "POST", body }); ME = res.user; renderApp("dashboard"); }
    catch (e) { $("#msg").innerHTML = `<div class="err">${esc(e.message)}</div>`; $("#go").disabled = false; }
  };
  $("#go").onclick = submit;
  $("#password").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

// ---------------- shell ----------------
const NAV = [
  { id: "dashboard", label: "Dashboard", ic: "dashboard" },
  { id: "items", label: "Items & BOMs", ic: "items" },
  { id: "ecos", label: "Change Orders", ic: "eco" },
  { id: "vendors", label: "Vendors", ic: "vendors" },
  { id: "search", label: "AI Search", ic: "search" },
];
const ADMIN_NAV = [
  { id: "import", label: "Import / Setup", ic: "import" },
  { id: "workflow", label: "ECO Workflow", ic: "workflow" },
  { id: "users", label: "Users", ic: "users" },
];

function renderApp(view) {
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="top"><div class="logo">${ICON.items}</div><b>Lite-PLM</b></div>
      <div class="co">Workspace <b>#${esc(ME.company_id || "")}</b></div>
      <nav id="nav">
        ${NAV.map((n) => `<a data-v="${n.id}">${ICON[n.ic]}<span>${n.label}</span></a>`).join("")}
        ${isAdmin() ? `<div class="grp">Admin</div>` + ADMIN_NAV.map((n) => `<a data-v="${n.id}">${ICON[n.ic]}<span>${n.label}</span></a>`).join("") : ""}
        <div class="grp">Developer</div><a data-v="api">${ICON.api}<span>API &amp; Tokens</span></a>
      </nav>
      <div class="me"><div class="nm">${esc(ME.name)}</div><div class="rl">${esc(ME.role)} · ${esc(ME.email)}</div>
        <button class="btn ghost sm" id="logout" style="margin-top:11px;width:100%">Sign out</button></div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  $("#logout").onclick = async () => { await api("/logout", { method: "POST" }); ME = null; renderAuth(); };
  $("#nav").addEventListener("click", (e) => { const a = e.target.closest("a[data-v]"); if (a) go(a.dataset.v); });
  go(view);
}
function setActive(v) { document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.v === v)); }
function go(v) {
  setActive(v);
  ({ dashboard: viewDashboard, items: viewItems, ecos: viewEcos, vendors: viewVendors, search: viewSearch, import: viewImport, workflow: viewWorkflow, users: viewUsers, api: viewApi }[v] || viewDashboard)();
}
const main = () => $("#main");
function toast(msg, kind = "good") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3400);
}

// ---------------- DASHBOARD ----------------
async function viewDashboard() {
  main().innerHTML = `<div class="page-h"><div><h2>Dashboard</h2><div class="sub">Overview of your product data.</div></div>
    ${canEdit() ? `<button class="btn" id="newItem">+ New item</button>` : ""}</div>
    <div class="stats" id="stats">
      ${["Items", "Released revs", "Change orders", "Vendors"].map((l) => `<div class="stat"><div class="ic">${ICON.items}</div><div class="n">—</div><div class="l">${l}</div></div>`).join("")}
    </div>
    <div class="grid2" style="margin-top:18px">
      <div class="card"><div class="card-h">Recent change orders</div><div id="recentEco"></div></div>
      <div class="card"><div class="card-h">Quick start</div><div class="card-b" id="quick"></div></div>
    </div>`;
  if (canEdit()) $("#newItem").onclick = () => go("items");
  const [items, ecos, vendors] = await Promise.all([api("/items"), api("/ecos"), api("/vendors")]);
  const released = items.items.filter((i) => i.latest_status === "released").length;
  const stat = (i, n, l, ic) => { const s = $("#stats").children[i]; s.querySelector(".n").textContent = fmt(n); s.querySelector(".l").textContent = l; s.querySelector(".ic").innerHTML = ICON[ic]; };
  stat(0, items.items.length, "Items", "items"); stat(1, released, "Released revs", "eco"); stat(2, ecos.ecos.length, "Change orders", "eco"); stat(3, vendors.vendors.length, "Vendors", "vendors");
  $("#recentEco").innerHTML = ecos.ecos.length
    ? `<div class="tablewrap"><table><tbody>${ecos.ecos.slice(0, 6).map((e) => `<tr class="click" data-id="${e.id}"><td class="num">${esc(e.number)}</td><td>${esc(e.title)}</td><td style="text-align:right">${badge(e.status)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">No change orders yet.</div>`;
  $("#recentEco").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => { go("ecos"); setTimeout(() => ecoDetail(tr.dataset.id), 30); });
  $("#quick").innerHTML = items.items.length === 0
    ? `<p class="muted" style="margin-bottom:12px">Your workspace is empty. ${isAdmin() ? "Load a sample catalog or import your own CSVs to get started." : "Ask an admin to import data."}</p>
       ${isAdmin() ? `<button class="btn" id="goImport">Import / Setup →</button>` : ""}`
    : `<div class="kv" style="line-height:2"><b>${fmt(items.items.length)}</b> items · <b>${fmt(released)}</b> released · <b>${fmt(vendors.vendors.length)}</b> vendors<br>
       Jump to <a id="qi">Items</a>, <a id="qe">Change Orders</a>, or <a id="qs">AI Search</a>.</div>`;
  if ($("#goImport")) $("#goImport").onclick = () => go("import");
  if ($("#qi")) { $("#qi").onclick = () => go("items"); $("#qe").onclick = () => go("ecos"); $("#qs").onclick = () => go("search"); }
}

// ---------------- ITEMS ----------------
let ITEMS_CACHE = [];
async function viewItems() {
  main().innerHTML = `<div class="page-h"><div><h2>Items &amp; BOMs</h2><div class="sub">Parts, revisions, and bills of material.</div></div>
    ${canEdit() ? `<button class="btn" id="i_new">+ New item</button>` : ""}</div>
    ${canEdit() ? `<div class="card" id="i_form" style="display:none"><div class="card-h">New item</div><div class="card-b">
      <div class="inline-form">
        <div class="field"><label>Number</label><input id="i_num" placeholder="CMP-1180"></div>
        <div class="field"><label>Name</label><input id="i_name" placeholder="Luer Connector, Polycarbonate"></div>
        <div class="field" style="max-width:120px"><label>Type</label><select id="i_type"><option>Make</option><option>Buy</option></select></div>
        <div class="field" style="max-width:150px"><label>Lifecycle</label><select id="i_life"><option>Prototype</option><option>Preproduction</option><option>Production</option></select></div>
        <div class="field" style="max-width:80px"><label>UoM</label><input id="i_uom" value="EA"></div>
        <button class="btn" id="i_add">Add item</button></div></div></div>` : ""}
    <div class="card"><div class="card-h"><span>All items</span><span class="count-tag" id="i_count"></span></div>
      <div class="card-b" style="padding-bottom:6px"><div class="filterbar"><input id="i_filter" placeholder="Filter by number or name…"></div></div>
      <div class="tablewrap" id="i_list" style="max-height:62vh"></div></div>`;
  if (canEdit()) {
    $("#i_new").onclick = () => { const f = $("#i_form"); f.style.display = f.style.display === "none" ? "" : "none"; };
    $("#i_add").onclick = async () => {
      try { await api("/items", { method: "POST", body: { number: $("#i_num").value, name: $("#i_name").value, uom: $("#i_uom").value, partType: $("#i_type").value, lifecycle: $("#i_life").value } }); toast("Item created (rev A)."); viewItems(); }
      catch (e) { toast(e.message, "bad"); }
    };
  }
  const { items } = await api("/items");
  ITEMS_CACHE = items;
  const draw = (rows) => {
    $("#i_count").textContent = fmt(rows.length) + " items";
    $("#i_list").innerHTML = rows.length ? `<table><thead><tr><th>Number</th><th>Name</th><th>Type</th><th>Lifecycle</th><th>UoM</th><th>Latest rev</th><th>Status</th></tr></thead><tbody>
      ${rows.slice(0, 600).map((i) => `<tr class="click" data-id="${i.id}"><td class="num">${esc(i.number)}</td><td>${esc(i.name)}</td>
        <td>${i.latest_type ? typeBadge(i.latest_type) : "—"}</td><td>${i.latest_lifecycle ? lifeBadge(i.latest_lifecycle) : "—"}</td>
        <td class="muted">${esc(i.uom)}</td><td class="mono">${esc(i.latest_rev || "—")}</td><td>${i.latest_status ? badge(i.latest_status) : "—"}</td></tr>`).join("")}
      </tbody></table>${rows.length > 600 ? `<div class="note" style="padding:12px 18px">Showing first 600 of ${fmt(rows.length)} — narrow with the filter above.</div>` : ""}`
      : `<div class="empty">No items match.</div>`;
    $("#i_list").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => itemDetail(tr.dataset.id));
  };
  draw(items);
  $("#i_filter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    draw(!q ? items : items.filter((i) => (i.number + " " + i.name).toLowerCase().includes(q)));
  });
}

async function itemDetail(id, focusRevId) {
  const d = await api("/items/" + id);
  const revs = d.revisions;
  if (!revs.length) { toast("Item has no revisions.", "bad"); return; }
  const focus = (focusRevId && revs.find((r) => String(r.id) === String(focusRevId))) || revs[revs.length - 1];
  const f = await api("/revisions/" + focus.id + "/focus");
  const editableRev = canEdit() && focus.status !== "released";

  main().innerHTML = `<span class="back" id="back">← Items</span>
    <div class="page-h"><div>
      <h2 class="mono" style="font-size:21px">${esc(d.item.number)}
        <span class="badge b-${esc(focus.status)}" style="font-size:11.5px;vertical-align:middle;margin-left:4px">Rev ${esc(focus.rev)} · ${esc(focus.status).replace("_", " ")}</span>
        ${typeBadge(focus.part_type)} ${lifeBadge(focus.lifecycle)}</h2>
      <div class="sub">${esc(d.item.name)}${d.item.description ? " — " + esc(d.item.description) : ""}${d.item.uom ? " · " + esc(d.item.uom) : ""}</div></div>
      ${canEdit() ? `<button class="btn ghost" id="revise">Revise → new working copy</button>` : ""}</div>
    ${editableRev ? `<div class="card"><div class="card-b" style="display:flex;gap:14px;align-items:end;flex-wrap:wrap">
      <div class="field" style="margin:0;max-width:160px"><label>Type (rev ${esc(focus.rev)})</label><select id="ed_type">${["Make","Buy"].map((t)=>`<option ${t===focus.part_type?"selected":""}>${t}</option>`).join("")}</select></div>
      <div class="field" style="margin:0;max-width:180px"><label>Lifecycle (rev ${esc(focus.rev)})</label><select id="ed_life">${["Prototype","Preproduction","Production"].map((t)=>`<option ${t===focus.lifecycle?"selected":""}>${t}</option>`).join("")}</select></div>
      <button class="btn sm" id="ed_save">Save attributes</button></div></div>` : ""}
    <div class="grid2">
      <div class="card"><div class="card-h"><span>Revisions</span>
        <div class="cmpbar"><span class="sel" id="cmpsel">select 2 to compare</span><button class="btn sm" id="cmpbtn" disabled>Compare</button></div></div>
        <div class="tablewrap"><table><thead><tr><th></th><th>Rev</th><th>Status</th><th>Type</th><th>Lifecycle</th><th>Released</th></tr></thead><tbody>
        ${revs.map((r) => `<tr class="click rev-row ${String(r.id) === String(focus.id) ? "active" : ""}" data-rev="${r.id}" data-letter="${esc(r.rev)}">
          <td><input type="checkbox" class="ck cmp-ck" data-rev="${r.id}" data-letter="${esc(r.rev)}"></td>
          <td class="mono">${esc(r.rev)}</td><td>${badge(r.status)}</td><td>${typeBadge(r.part_type)}</td><td>${lifeBadge(r.lifecycle)}</td>
          <td class="muted">${r.released_at ? new Date(r.released_at).toLocaleDateString() : "—"}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="card"><div class="card-h">Where used <span class="hint">rev ${esc(focus.rev)}</span></div>
        ${f.whereUsed.length ? `<div class="tablewrap"><table><thead><tr><th>Assembly</th><th>Name</th><th>Uses rev</th><th>Qty</th></tr></thead><tbody>
          ${f.whereUsed.map((w) => `<tr class="click wu-row" data-item="${w.item_id}"><td class="num">${esc(w.number)}</td><td>${esc(w.name)}</td><td class="mono muted">${esc(w.parent_rev)}</td><td>${esc(w.qty)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Not used in any BOM at this revision.</div>`}</div>
    </div>
    <div class="card"><div class="card-h"><span>BOM</span><span class="hint">rev ${esc(focus.rev)} · ${badge(focus.status)}</span></div><div class="card-b" id="bomwrap"></div></div>
    <div class="card"><div class="card-h">Vendor parts <span class="hint">rev ${esc(focus.rev)}</span></div><div id="vpwrap"></div></div>`;

  $("#back").onclick = viewItems;
  if (canEdit()) $("#revise").onclick = async () => { try { const r = await api("/items/" + id + "/revise", { method: "POST" }); toast("Created working rev " + r.revision.rev + "."); itemDetail(id, r.revision.id); } catch (e) { toast(e.message, "bad"); } };
  if (editableRev) $("#ed_save").onclick = async () => { try { await api("/revisions/" + focus.id, { method: "PATCH", body: { partType: $("#ed_type").value, lifecycle: $("#ed_life").value } }); toast("Attributes updated."); itemDetail(id, focus.id); } catch (e) { toast(e.message, "bad"); } };
  // revision focus (ignore clicks originating on the checkbox)
  $("#main").querySelectorAll(".rev-row").forEach((tr) => tr.onclick = (e) => { if (e.target.classList.contains("cmp-ck")) return; itemDetail(id, tr.dataset.rev); });
  $("#main").querySelectorAll(".wu-row").forEach((tr) => tr.onclick = () => itemDetail(tr.dataset.item));
  // compare selection
  const sel = [];
  $("#main").querySelectorAll(".cmp-ck").forEach((ck) => ck.onclick = (e) => {
    e.stopPropagation();
    const id2 = ck.dataset.rev;
    const i = sel.findIndex((s) => s.id === id2);
    if (ck.checked) { if (sel.length >= 2) { ck.checked = false; toast("Pick exactly two revisions.", "bad"); return; } sel.push({ id: id2, letter: ck.dataset.letter }); }
    else if (i >= 0) sel.splice(i, 1);
    $("#cmpsel").textContent = sel.length ? sel.map((s) => "Rev " + s.letter).join(" ↔ ") : "select 2 to compare";
    $("#cmpbtn").disabled = sel.length !== 2;
  });
  $("#cmpbtn").onclick = () => {
    if (sel.length !== 2) return;
    const ordered = [...sel].sort((a, b) => a.letter.localeCompare(b.letter)); // earlier = from
    compareRevsModal(ordered[0].id, ordered[1].id, d.item.number);
  };
  renderBom(focus, id, f.bom);
  renderVendorParts(f.vendorParts, d.item, focus);
}

async function compareRevsModal(fromId, toId, itemNumber) {
  try {
    const r = await api("/compare?from=" + fromId + "&to=" + toId);
    openModal(`Compare — ${esc(itemNumber)}`,
      `<div class="rl-cmp-h">Rev ${esc(r.from.rev)} <span class="arrow">→</span> Rev ${esc(r.to.rev)} <span class="muted">BOM redline</span></div>` + redlineHtml(r.diff), true);
  } catch (e) { toast(e.message, "bad"); }
}

// redline list -> html (shared by rev compare and ECO compare)
function redlineHtml(diff) {
  if (!diff.length) return `<div class="redline"><div class="rl-none">No BOM changes between these revisions.</div></div>`;
  const tag = { add: '<span class="rl-tag rl-add">ADD</span>', delete: '<span class="rl-tag rl-del">DELETE</span>', update: '<span class="rl-tag rl-upd">UPDATE</span>' };
  return `<div class="redline">${diff.map((e) => {
    let detail = "";
    if (e.type === "add") detail = `<div class="rl-chg">Added to BOM${e.child_rev ? ` · child rev ${esc(e.child_rev)}` : ""}${e.qty != null ? ` · qty ${esc(e.qty)}` : ""}</div>`;
    else if (e.type === "delete") detail = `<div class="rl-chg">Removed from BOM</div>`;
    else detail = `<div class="rl-chg">${e.changes.map((c) => `${esc(c.field)}: <span class="rl-from">${esc(c.from)}</span> → <span class="rl-to">${esc(c.to)}</span>`).join(" · ")}</div>`;
    return `<div class="rl-row">${tag[e.type]}<div class="rl-main"><span class="pn">${esc(e.child_number)}</span> ${esc(e.child_name || "")}${detail}</div></div>`;
  }).join("")}</div>`;
}

function renderBom(rev, itemId, lines) {
  const editable = canEdit() && rev.status !== "released";
  $("#bomwrap").innerHTML = `
    ${lines.length ? `<div class="tablewrap"><table><thead><tr><th>Child</th><th>Name</th><th>Type</th><th>Child rev</th><th>Qty</th><th>Ref des</th>${editable ? "<th></th>" : ""}</tr></thead><tbody>
      ${lines.map((l) => `<tr><td class="num click bomchild" data-num="${esc(l.child_number)}">${esc(l.child_number)}</td><td>${esc(l.child_name)}</td><td>${l.child_type ? typeBadge(l.child_type) : "—"}</td><td class="mono muted">${esc(l.child_rev || "—")}</td><td>${esc(l.qty)}</td><td class="muted">${esc(l.ref_des || "")}</td>
        ${editable ? `<td style="text-align:right"><button class="btn danger sm" data-del="${l.id}">remove</button></td>` : ""}</tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">No components on this revision.</div>`}
    ${editable ? `<div class="inline-form" style="margin-top:14px">
      <div class="field"><label>Child item #</label><input id="b_child" placeholder="CMP-1180"></div>
      <div class="field" style="max-width:90px"><label>Qty</label><input id="b_qty" value="1"></div>
      <div class="field"><label>Ref des</label><input id="b_ref" placeholder="R1, R2"></div>
      <button class="btn" id="b_add">Add component</button></div>`
    : rev.status === "released" ? `<div class="note">This revision is released and locked. Use “Revise” to make changes.</div>` : ""}`;
  $("#bomwrap").querySelectorAll(".bomchild").forEach((td) => td.onclick = async () => {
    try { const items = ITEMS_CACHE.length ? ITEMS_CACHE : (await api("/items")).items; const it = items.find((x) => x.number === td.dataset.num); if (it) itemDetail(it.id); } catch (_) {}
  });
  if (editable) {
    $("#b_add").onclick = async () => { try { await api("/revisions/" + rev.id + "/bom", { method: "POST", body: { childNumber: $("#b_child").value, qty: $("#b_qty").value, refDes: $("#b_ref").value } }); itemDetail(itemId, rev.id); } catch (e) { toast(e.message, "bad"); } };
    $("#bomwrap").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { try { await api("/bom/" + b.dataset.del, { method: "DELETE" }); itemDetail(itemId, rev.id); } catch (e) { toast(e.message, "bad"); } });
  }
}

function renderVendorParts(vps, item, rev) {
  $("#vpwrap").innerHTML = vps.length ? `<div class="tablewrap"><table><thead><tr><th>Vendor</th><th>Vendor P/N</th><th>Price</th></tr></thead><tbody>
    ${vps.map((v, i) => `<tr><td>${esc(v.vendor_code)} — ${esc(v.vendor_name)}</td><td><span class="num linklike vp-open" data-i="${i}">${esc(v.vendor_part_number)}</span></td><td class="mono">$${esc(v.price)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">No vendor parts at this revision.</div>`;
  $("#vpwrap").querySelectorAll(".vp-open").forEach((el) => el.onclick = () => vendorPartModal(vps[+el.dataset.i], item, rev));
}

// ---- modal helpers ----
function openModal(title, bodyHtml, wide) {
  closeModal();
  const bg = document.createElement("div"); bg.className = "modal-bg"; bg.id = "modalBg";
  bg.innerHTML = `<div class="modal" style="max-width:${wide ? 620 : 440}px"><div class="modal-h"><b>${title}</b><button class="modal-x" id="modalX">×</button></div><div class="modal-b">${bodyHtml}</div></div>`;
  document.body.appendChild(bg);
  bg.addEventListener("click", (e) => { if (e.target === bg) closeModal(); });
  $("#modalX").onclick = closeModal;
  document.addEventListener("keydown", escClose);
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
function closeModal() { const m = $("#modalBg"); if (m) m.remove(); document.removeEventListener("keydown", escClose); }
function vendorPartModal(vp, item, rev) {
  const row = (k, v, mono) => `<div class="proprow"><span class="k">${k}</span><span class="v ${mono ? "mono" : ""}">${esc(v)}</span></div>`;
  openModal("Vendor part", `
    ${row("Vendor P/N", vp.vendor_part_number, true)}
    ${row("Vendor", vp.vendor_code + " — " + vp.vendor_name)}
    ${row("Unit price", "$" + vp.price, true)}
    ${row("For item", item.number, true)}
    ${row("Item revision", "Rev " + rev.rev, true)}
    ${vp.vendor_contact ? row("Vendor contact", vp.vendor_contact) : ""}`);
}


async function ecoCompareModal(ecoId) {
  try {
    const r = await api("/ecos/" + ecoId + "/compare");
    const body = r.comparisons.map((c) => `
      <div class="cmp-item-h"><span class="pn mono" style="color:var(--teal-d)">${esc(c.number)}</span> ${esc(c.name)}
        <span class="muted mono" style="font-weight:400">${c.fromRev ? "Rev " + esc(c.fromRev) : "(no prior released)"} → Rev ${esc(c.toRev)}</span></div>
      ${redlineHtml(c.diff)}`).join("");
    openModal(`ECO ${esc(r.eco.number)} — BOM changes`, body || `<div class="rl-none">No affected items.</div>`, true);
  } catch (e) { toast(e.message, "bad"); }
}

// ---------------- ECOs ----------------
async function viewEcos() {
  main().innerHTML = `<div class="page-h"><div><h2>Engineering Change Orders</h2><div class="sub">Route changes through approval; release on implement.</div></div>
    ${canEdit() ? `<button class="btn" id="e_new">+ New ECO</button>` : ""}</div>
    ${canEdit() ? `<div class="card" id="e_form" style="display:none"><div class="card-h">New ECO</div><div class="card-b"><div class="inline-form">
      <div class="field"><label>Number</label><input id="e_num" placeholder="ECO-1042"></div>
      <div class="field"><label>Title</label><input id="e_title" placeholder="Update tubing durometer"></div>
      <button class="btn" id="e_add">Create ECO</button></div></div></div>` : ""}
    <div class="card"><div class="card-h">All ECOs</div><div class="tablewrap" id="e_list"></div></div>`;
  if (canEdit()) {
    $("#e_new").onclick = () => { const f = $("#e_form"); f.style.display = f.style.display === "none" ? "" : "none"; };
    $("#e_add").onclick = async () => { try { const r = await api("/ecos", { method: "POST", body: { number: $("#e_num").value, title: $("#e_title").value } }); toast("ECO created."); ecoDetail(r.eco.id); } catch (e) { toast(e.message, "bad"); } };
  }
  const { ecos } = await api("/ecos");
  $("#e_list").innerHTML = ecos.length ? `<table><thead><tr><th>Number</th><th>Title</th><th>Status</th></tr></thead><tbody>
    ${ecos.map((e) => `<tr class="click" data-id="${e.id}"><td class="num">${esc(e.number)}</td><td>${esc(e.title)}</td><td>${badge(e.status)}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No change orders yet.</div>`;
  $("#e_list").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => ecoDetail(tr.dataset.id));
}

async function ecoDetail(id) {
  const d = await api("/ecos/" + id);
  const e = d.eco;
  const stepEls = d.steps.map((s) => {
    const cls = e.status === "implemented" || s.seq < e.current_seq ? "done" : (s.seq === e.current_seq && e.status === "in_review" ? "cur" : "");
    return `<span class="step ${cls}"><span class="seq">${s.seq}</span>${esc(s.name)} <span class="mono muted">(${esc(s.role)})</span></span>`;
  }).join('<span class="arrow">→</span>');
  const canDecide = e.status === "in_review" && d.pendingStep && (ME.role === d.pendingStep.role || ME.role === "admin");

  main().innerHTML = `<span class="back" id="back">← Change Orders</span>
    <div class="page-h"><div><h2 class="mono" style="font-size:20px">${esc(e.number)} ${badge(e.status)}</h2><div class="sub">${esc(e.title)}</div></div></div>
    <div class="card"><div class="card-h">Approval route</div><div class="card-b"><div class="steps">${stepEls || '<span class="muted">No workflow configured.</span>'}</div></div></div>
    <div class="card"><div class="card-h"><span>Affected items</span>${d.affected.length ? `<button class="btn ghost sm" id="ecoCompare">Compare BOMs (From → To)</button>` : ""}</div><div class="card-b" id="aff"></div></div>
    ${canDecide ? `<div class="card"><div class="card-h">Your decision — ${esc(d.pendingStep.name)}</div><div class="card-b">
      <div class="field"><label>Disposition</label><input id="disp" placeholder="Use-as-is, Rework, Scrap"></div>
      <div class="field"><label>Comment</label><textarea id="cmt" rows="2"></textarea></div>
      <div class="row"><button class="btn" id="approve">Approve step</button><button class="btn danger" id="reject">Reject ECO</button></div></div></div>` : ""}
    <div class="card"><div class="card-h">Approval history</div><div class="tablewrap" id="hist"></div></div>`;
  $("#back").onclick = viewEcos;
  if ($("#ecoCompare")) $("#ecoCompare").onclick = () => ecoCompareModal(id);
  const draft = e.status === "draft" && canEdit();
  $("#aff").innerHTML = `
    ${d.affected.length ? `<div class="tablewrap"><table><thead><tr><th>Item</th><th>Name</th><th>Rev</th><th>Status</th></tr></thead><tbody>
      ${d.affected.map((a) => `<tr><td class="num">${esc(a.number)}</td><td>${esc(a.name)}</td><td class="mono">${esc(a.rev)}</td><td>${badge(a.status)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">No affected items yet.</div>`}
    ${draft ? `<div class="inline-form" style="margin-top:14px">
      <div class="field"><label>Add working revision (item number)</label><input id="aff_num" placeholder="FG-1000"></div>
      <button class="btn ghost" id="aff_add">Add affected item</button><button class="btn" id="submit">Submit for approval →</button></div>
      <div class="note">Adds the item's current working revision. Submitting moves it into review and locks editing.</div>` : ""}`;
  if (draft) {
    $("#aff_add").onclick = async () => {
      try { const items = await api("/items"); const it = items.items.find((x) => x.number === $("#aff_num").value.trim());
        if (!it) throw new Error("No item with that number.");
        const full = await api("/items/" + it.id); const work = full.revisions.filter((r) => r.status === "working").pop();
        if (!work) throw new Error("That item has no working revision to change.");
        await api("/ecos/" + id + "/affected", { method: "POST", body: { revisionId: work.id } }); ecoDetail(id);
      } catch (e2) { toast(e2.message, "bad"); }
    };
    $("#submit").onclick = async () => { try { await api("/ecos/" + id + "/submit", { method: "POST" }); toast("Submitted for approval."); ecoDetail(id); } catch (e2) { toast(e2.message, "bad"); } };
  }
  if (canDecide) {
    $("#approve").onclick = async () => { try { const r = await api("/ecos/" + id + "/decide", { method: "POST", body: { decision: "approve", disposition: $("#disp").value, comment: $("#cmt").value } });
      toast(r.result === "implemented" ? "Implemented — affected revisions released." : r.result === "advanced" ? "Approved — advanced to " + r.nextStep : "Approved."); ecoDetail(id); } catch (e2) { toast(e2.message, "bad"); } };
    $("#reject").onclick = async () => { try { await api("/ecos/" + id + "/decide", { method: "POST", body: { decision: "reject", disposition: $("#disp").value, comment: $("#cmt").value } }); toast("ECO rejected.", "bad"); ecoDetail(id); } catch (e2) { toast(e2.message, "bad"); } };
  }
  $("#hist").innerHTML = d.approvals.length ? `<table><thead><tr><th>Step</th><th>Decision</th><th>Disposition</th><th>By</th><th>When</th></tr></thead><tbody>
    ${d.approvals.map((a) => `<tr><td>${esc(a.seq)}</td><td>${a.decision === "approve" ? "✓ approve" : "✗ reject"}</td><td>${esc(a.disposition || "")}</td><td>${esc(a.approver_name || "")}</td><td class="muted">${new Date(a.decided_at).toLocaleString()}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No decisions yet.</div>`;
}

// ---------------- VENDORS ----------------
async function viewVendors() {
  main().innerHTML = `<div class="page-h"><div><h2>Vendors</h2><div class="sub">Suppliers and the parts they provide.</div></div></div>
    ${canEdit() ? `<div class="grid2">
      <div class="card"><div class="card-h">New vendor</div><div class="card-b">
        <div class="field"><label>Code</label><input id="v_code" placeholder="QOSINA"></div>
        <div class="field"><label>Name</label><input id="v_name" placeholder="Qosina"></div>
        <div class="field"><label>Contact</label><input id="v_contact" placeholder="oem@qosina.com"></div>
        <button class="btn" id="v_add">Add vendor</button></div></div>
      <div class="card"><div class="card-h">Link a vendor part</div><div class="card-b">
        <div class="field"><label>Vendor</label><select id="vp_vendor"></select></div>
        <div class="field"><label>Item number</label><input id="vp_item" placeholder="CMP-1180"></div>
        <div class="field"><label>Vendor P/N</label><input id="vp_pn" placeholder="QOS-55-12"></div>
        <div class="field" style="max-width:130px"><label>Price</label><input id="vp_price" value="0"></div>
        <button class="btn" id="vp_add">Link part</button></div></div></div>` : ""}
    <div class="card"><div class="card-h">All vendors</div><div class="tablewrap" id="v_list"></div></div>`;
  const { vendors } = await api("/vendors");
  $("#v_list").innerHTML = vendors.length ? `<table><thead><tr><th>Code</th><th>Name</th><th>Contact</th></tr></thead><tbody>
    ${vendors.map((v) => `<tr><td class="num">${esc(v.code)}</td><td>${esc(v.name)}</td><td class="muted">${esc(v.contact || "")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No vendors yet.</div>`;
  if (canEdit()) {
    $("#vp_vendor").innerHTML = vendors.map((v) => `<option value="${v.id}">${esc(v.code)} — ${esc(v.name)}</option>`).join("");
    $("#v_add").onclick = async () => { try { await api("/vendors", { method: "POST", body: { code: $("#v_code").value, name: $("#v_name").value, contact: $("#v_contact").value } }); toast("Vendor added."); viewVendors(); } catch (e) { toast(e.message, "bad"); } };
    $("#vp_add").onclick = async () => { try { await api("/vendor-parts", { method: "POST", body: { vendorId: $("#vp_vendor").value, itemNumber: $("#vp_item").value, vendorPartNumber: $("#vp_pn").value, price: $("#vp_price").value } }); toast("Vendor part linked."); } catch (e) { toast(e.message, "bad"); } };
  }
}

// ---------------- SEARCH ----------------
async function viewSearch() {
  main().innerHTML = `<div class="page-h"><div><h2>AI Search</h2><div class="sub">Ask in plain English across parts and vendors.</div></div></div>
    <div class="card"><div class="card-b">
      <div class="searchbar"><input id="q" placeholder="e.g. released silicone tubing, or connectors in EA"><button class="btn" id="s_go">Search</button></div>
      <div class="modehint">${META.aiEnabled ? `<span class="dot on"></span> AI interpretation on` : `<span class="dot off"></span> Keyword mode — set OPENAI_API_KEY to enable AI`}</div>
    </div></div>
    <div class="card"><div class="card-h">Results</div><div class="tablewrap" id="s_res"><div class="empty">Type a query above.</div></div></div>`;
  const run = async () => {
    const q = $("#q").value.trim(); if (!q) return;
    $("#s_res").innerHTML = `<div class="empty">Searching…</div>`;
    try {
      const d = await api("/search?q=" + encodeURIComponent(q));
      if (!d.results.length) { $("#s_res").innerHTML = `<div class="empty">No matches <span class="muted">(${d.mode} mode)</span>.</div>`; return; }
      if (d.entity === "vendors") {
        $("#s_res").innerHTML = `<table><thead><tr><th>Code</th><th>Name</th><th>Contact</th></tr></thead><tbody>${d.results.map((v) => `<tr><td class="num">${esc(v.code)}</td><td>${esc(v.name)}</td><td class="muted">${esc(v.contact || "")}</td></tr>`).join("")}</tbody></table><div class="note">Vendor search · ${esc(d.mode)} mode.</div>`;
      } else {
        $("#s_res").innerHTML = `<table><thead><tr><th>Number</th><th>Name</th><th>UoM</th><th>Status</th></tr></thead><tbody>${d.results.map((i) => `<tr class="click" data-id="${i.id}"><td class="num">${esc(i.number)}</td><td>${esc(i.name)}</td><td class="muted">${esc(i.uom)}</td><td>${i.latest_status ? badge(i.latest_status) : "—"}</td></tr>`).join("")}</tbody></table><div class="note">${d.results.length} result(s) · ${esc(d.mode)} mode${d.mode === "ai" ? " — interpreted by the model" : ""}.</div>`;
        $("#s_res").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => itemDetail(tr.dataset.id));
      }
    } catch (e) { $("#s_res").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $("#s_go").onclick = run;
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

// ---------------- IMPORT / SETUP (admin) ----------------
async function viewImport() {
  main().innerHTML = `<div class="page-h"><div><h2>Import / Setup</h2><div class="sub">Seed your workspace from CSV. Importing replaces existing items, BOMs, vendors and revisions.</div></div></div>
  <div class="import-grid">
    <div class="dataset">
      <h3>Sample catalog — medical supplier</h3>
      <p class="muted" style="margin-top:6px">A realistic small-cap medical device catalog you can explore immediately.</p>
      <div class="meta"><span class="chip">1,200 parts</span><span class="chip">3–4 revs each</span><span class="chip">200 BOMs</span><span class="chip">multi-level</span><span class="chip">620 commodities</span><span class="chip">1,800+ vendor parts</span></div>
      <button class="btn" id="loadSample">Load sample catalog</button>
      <div class="note">Wipes current data and loads the sample. Great for a first look.</div>
      <div id="sampleRes"></div>
    </div>
    <div class="card"><div class="card-h">Import your own CSVs</div><div class="card-b">
      <div class="filebox"><label>items.csv <span class="muted">(required)</span></label><input type="file" id="f_items" accept=".csv"></div>
      <div class="filebox"><label>revisions.csv</label><input type="file" id="f_revisions" accept=".csv"></div>
      <div class="filebox"><label>boms.csv</label><input type="file" id="f_boms" accept=".csv"></div>
      <div class="filebox"><label>vendors.csv</label><input type="file" id="f_vendors" accept=".csv"></div>
      <div class="filebox"><label>vendor_parts.csv</label><input type="file" id="f_vparts" accept=".csv"></div>
      <button class="btn dark" id="doImport">Import CSVs (replace)</button>
      <div id="uploadRes"></div>
    </div></div>
  </div>
  <div class="card"><div class="card-h">CSV formats</div><div class="card-b">
    <div class="code">items.csv         number, name, description, uom
revisions.csv     item_number, rev, status            status = working | released | obsolete
boms.csv          parent_number, parent_rev, child_number, qty, ref_des
vendors.csv       code, name, contact
vendor_parts.csv  vendor_code, item_number, vendor_part_number, price</div>
    <div class="note">Files reference each other by part number / vendor code, so import them together. Revisions and BOMs are optional — items alone create a rev A for each.</div>
  </div></div>`;
  $("#loadSample").onclick = async () => {
    if (!confirm("Load the sample catalog? This replaces all current items, BOMs, vendors and revisions in your workspace.")) return;
    const b = $("#loadSample"); b.disabled = true; b.innerHTML = `<span class="spin"></span> Loading…`;
    try { const r = await api("/import/sample", { method: "POST" });
      $("#sampleRes").innerHTML = `<div class="ok" style="margin-top:14px">Loaded: ${fmt(r.counts.items)} items · ${fmt(r.counts.revisions)} revisions · ${fmt(r.counts.bomLines)} BOM lines · ${fmt(r.counts.vendors)} vendors · ${fmt(r.counts.vendorParts)} vendor parts.</div>`;
      toast("Sample catalog loaded."); }
    catch (e) { $("#sampleRes").innerHTML = `<div class="err" style="margin-top:14px">${esc(e.message)}</div>`; }
    finally { b.disabled = false; b.textContent = "Load sample catalog"; }
  };
  const readFile = (inp) => new Promise((res) => { const f = inp.files[0]; if (!f) return res(""); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); });
  $("#doImport").onclick = async () => {
    if (!$("#f_items").files[0]) { toast("items.csv is required.", "bad"); return; }
    if (!confirm("Import these CSVs? This replaces all current items, BOMs, vendors and revisions.")) return;
    const b = $("#doImport"); b.disabled = true; b.innerHTML = `<span class="spin"></span> Importing…`;
    try {
      const body = { items: await readFile($("#f_items")), revisions: await readFile($("#f_revisions")), boms: await readFile($("#f_boms")), vendors: await readFile($("#f_vendors")), vendorParts: await readFile($("#f_vparts")) };
      const r = await api("/import", { method: "POST", body });
      $("#uploadRes").innerHTML = `<div class="ok" style="margin-top:14px">Imported: ${fmt(r.counts.items)} items · ${fmt(r.counts.revisions)} revisions · ${fmt(r.counts.bomLines)} BOM lines · ${fmt(r.counts.vendors)} vendors · ${fmt(r.counts.vendorParts)} vendor parts.</div>`;
      toast("Import complete.");
    } catch (e) { $("#uploadRes").innerHTML = `<div class="err" style="margin-top:14px">${esc(e.message)}</div>`; }
    finally { b.disabled = false; b.textContent = "Import CSVs (replace)"; }
  };
}

// ---------------- WORKFLOW (admin) ----------------
async function viewWorkflow() {
  const { steps } = await api("/workflow");
  main().innerHTML = `<div class="page-h"><div><h2>ECO Workflow</h2><div class="sub">Ordered approval chain. Each step is gated by a role.</div></div></div>
    <div class="card"><div class="card-h">Approval steps</div><div class="card-b">
      <div id="steps"></div>
      <button class="btn ghost sm" id="addstep" style="margin-top:10px">+ Add step</button>
      <div style="margin-top:16px"><button class="btn" id="save">Save workflow</button></div>
      <div class="note">ECOs walk these steps top to bottom. Final approval implements the ECO and releases all affected revisions.</div>
    </div></div>`;
  const ROLES = ["engineer", "approver", "admin", "viewer"];
  let rows = steps.length ? steps.map((s) => ({ name: s.name, role: s.role })) : [{ name: "Engineering review", role: "engineer" }, { name: "Approval", role: "approver" }];
  const draw = () => {
    $("#steps").innerHTML = rows.map((s, i) => `<div class="row" style="margin-bottom:10px" data-i="${i}">
      <div class="field" style="flex:2"><label>Step ${i + 1}</label><input class="s_name" value="${esc(s.name)}"></div>
      <div class="field" style="max-width:190px"><label>Approver role</label><select class="s_role">${ROLES.map((r) => `<option ${r === s.role ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      <button class="btn danger sm s_del">remove</button></div>`).join("");
    $("#steps").querySelectorAll(".s_del").forEach((b, i) => b.onclick = () => { rows.splice(i, 1); draw(); });
  };
  draw();
  $("#addstep").onclick = () => { rows.push({ name: "New step", role: "approver" }); draw(); };
  $("#save").onclick = async () => {
    const out = [...$("#steps").querySelectorAll("[data-i]")].map((d) => ({ name: d.querySelector(".s_name").value, role: d.querySelector(".s_role").value }));
    try { await api("/workflow", { method: "PUT", body: { steps: out } }); toast("Workflow saved."); } catch (e) { toast(e.message, "bad"); }
  };
}

// ---------------- USERS (admin) ----------------
async function viewUsers() {
  main().innerHTML = `<div class="page-h"><div><h2>Users</h2><div class="sub">People in your workspace and their roles.</div></div></div>
    <div class="card"><div class="card-h">Invite user</div><div class="card-b"><div class="inline-form">
      <div class="field"><label>Name</label><input id="u_name"></div>
      <div class="field"><label>Email</label><input id="u_email" type="email"></div>
      <div class="field"><label>Temp password</label><input id="u_pass"></div>
      <div class="field" style="max-width:160px"><label>Role</label><select id="u_role"><option>engineer</option><option>approver</option><option>admin</option><option>viewer</option></select></div>
      <button class="btn" id="u_add">Add user</button></div></div></div>
    <div class="card"><div class="card-h">All users</div><div class="tablewrap" id="u_list"></div></div>`;
  $("#u_add").onclick = async () => { try { await api("/users", { method: "POST", body: { name: $("#u_name").value, email: $("#u_email").value, password: $("#u_pass").value, role: $("#u_role").value } }); toast("User added."); viewUsers(); } catch (e) { toast(e.message, "bad"); } };
  const { users } = await api("/users");
  $("#u_list").innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.name)}</td><td class="muted">${esc(u.email)}</td><td>${badge(u.role)}</td></tr>`).join("")}</tbody></table>`;
}

// ---------------- API & TOKENS ----------------
async function viewApi() {
  main().innerHTML = `<div class="page-h"><div><h2>API &amp; Tokens</h2><div class="sub">Integrate other systems with a bearer token.</div></div></div>
    <div class="card"><div class="card-h">Your tokens</div><div class="card-b">
      <div class="inline-form"><div class="field"><label>Token name</label><input id="t_name" placeholder="erp-sync"></div><button class="btn" id="t_add">Generate token</button></div>
      <div id="t_flash"></div><div id="t_list" style="margin-top:12px"></div></div></div>
    <div class="card"><div class="card-h">Published API</div><div class="card-b">
      <p class="muted" style="margin-bottom:12px">Send <span class="mono">Authorization: Bearer &lt;token&gt;</span>. All calls are scoped to your company.</p>
      <div class="code">GET  /api/items                     list items
POST /api/items                     { number, name, uom }
GET  /api/items/:id                 item + revisions + where-used
POST /api/items/:id/revise          new working revision
GET  /api/revisions/:revId/bom      BOM lines
POST /api/revisions/:revId/bom      { childNumber, qty, refDes }
GET  /api/ecos                      list change orders
GET  /api/search?q=...              AI / keyword search</div>
      <div class="note">Example: <span class="mono">curl -H "Authorization: Bearer plm_xxx" https://plm.athenabot.ai/api/items</span></div>
    </div></div>`;
  $("#t_add").onclick = async () => { try { const r = await api("/tokens", { method: "POST", body: { name: $("#t_name").value } }); $("#t_flash").innerHTML = `<div class="tokenflash">${esc(r.token)}<div class="note" style="margin-top:6px">${esc(r.note)}</div></div>`; loadTokens(); } catch (e) { toast(e.message, "bad"); } };
  loadTokens();
}
async function loadTokens() {
  const { tokens } = await api("/tokens");
  $("#t_list").innerHTML = tokens.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Created</th></tr></thead><tbody>
    ${tokens.map((t) => `<tr><td>${esc(t.name)}</td><td class="muted">${new Date(t.created_at).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No tokens yet.</div>`;
}
