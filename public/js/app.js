// js/app.js — Lite-PLM single-page app (vanilla, no build step).
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

// ---------------- boot ----------------
(async function boot() {
  try { META = await api("/meta"); } catch (_) {}
  try { const m = await api("/me"); ME = m.user; renderApp("items"); }
  catch (_) { renderAuth(); }
})();

// ---------------- auth ----------------
function renderAuth(mode = "login") {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="brandrow"><div class="logo">PLM</div><h1>Lite-PLM</h1></div>
    <div class="sub">${mode === "signup" ? "Create your company workspace." : "Sign in to your workspace."}</div>
    <div id="msg"></div>
    ${mode === "signup" ? `
      <div class="field"><label>Company name</label><input id="company" placeholder="Acme Manufacturing"></div>
      <div class="field"><label>Your name</label><input id="name" placeholder="Jordan Lee"></div>` : ""}
    <div class="field"><label>Email</label><input id="email" type="email" placeholder="you@company.com"></div>
    <div class="field"><label>Password</label><input id="password" type="password" placeholder="••••••••"></div>
    <button class="btn block" id="go">${mode === "signup" ? "Create workspace" : "Sign in"}</button>
    <div class="swap">${mode === "signup"
      ? `Already have a workspace? <a id="swap">Sign in</a>`
      : `New here? <a id="swap">Create a workspace</a>`}</div>
  </div></div>`;
  $("#swap").onclick = () => renderAuth(mode === "signup" ? "login" : "signup");
  $("#go").onclick = async () => {
    const body = { email: $("#email").value.trim(), password: $("#password").value };
    if (mode === "signup") { body.company = $("#company").value.trim(); body.name = $("#name").value.trim(); }
    $("#go").disabled = true;
    try {
      const res = await api("/" + (mode === "signup" ? "signup" : "login"), { method: "POST", body });
      ME = res.user; renderApp("items");
    } catch (e) { $("#msg").innerHTML = `<div class="err">${esc(e.message)}</div>`; $("#go").disabled = false; }
  };
}

// ---------------- shell ----------------
const NAV = [
  { id: "items", label: "Items & BOMs" },
  { id: "ecos", label: "Change Orders" },
  { id: "vendors", label: "Vendors" },
  { id: "search", label: "AI Search" },
];
const ADMIN_NAV = [
  { id: "workflow", label: "ECO Workflow" },
  { id: "users", label: "Users" },
];

function renderApp(view) {
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="top"><div class="logo">PLM</div><b>Lite-PLM</b></div>
      <div class="co">Workspace · company #${esc(ME.company_id || "")}</div>
      <nav id="nav">
        ${NAV.map((n) => `<a data-v="${n.id}">${n.label}</a>`).join("")}
        ${isAdmin() ? `<div class="grp">Admin</div>` + ADMIN_NAV.map((n) => `<a data-v="${n.id}">${n.label}</a>`).join("") : ""}
        <div class="grp">Developer</div><a data-v="api">API & Tokens</a>
      </nav>
      <div class="me"><div class="nm">${esc(ME.name)}</div><div class="rl">${esc(ME.role)} · ${esc(ME.email)}</div>
        <button class="btn ghost sm" id="logout" style="margin-top:10px">Sign out</button></div>
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
  ({ items: viewItems, ecos: viewEcos, vendors: viewVendors, search: viewSearch, workflow: viewWorkflow, users: viewUsers, api: viewApi }[v] || viewItems)();
}
const main = () => $("#main");
const flash = (msg, kind = "ok") => { const d = document.createElement("div"); d.className = kind; d.textContent = msg; main().prepend(d); setTimeout(() => d.remove(), 3200); };

// ---------------- ITEMS ----------------
async function viewItems() {
  main().innerHTML = `<div class="page-h"><div><h2>Items & BOMs</h2><div class="sub">Parts, revisions, and bills of material.</div></div></div>
    ${canEdit() ? `<div class="card"><div class="card-h">New item</div><div class="card-b">
      <div class="inline-form">
        <div class="field"><label>Number</label><input id="i_num" placeholder="40-1180"></div>
        <div class="field"><label>Name</label><input id="i_name" placeholder="Bracket, mounting"></div>
        <div class="field"><label>UoM</label><input id="i_uom" value="EA" style="width:80px"></div>
        <button class="btn" id="i_add">Add item</button>
      </div></div></div>` : ""}
    <div class="card"><div class="card-h">All items</div><div id="i_list"></div></div>`;
  if (canEdit()) $("#i_add").onclick = async () => {
    try { await api("/items", { method: "POST", body: { number: $("#i_num").value, name: $("#i_name").value, uom: $("#i_uom").value } });
      flash("Item created (rev A, working)."); viewItems();
    } catch (e) { flash(e.message, "err"); }
  };
  const { items } = await api("/items");
  $("#i_list").innerHTML = items.length ? `<table><thead><tr><th>Number</th><th>Name</th><th>UoM</th><th>Latest rev</th><th>Status</th></tr></thead><tbody>
    ${items.map((i) => `<tr class="click" data-id="${i.id}"><td class="mono">${esc(i.number)}</td><td>${esc(i.name)}</td><td>${esc(i.uom)}</td>
      <td class="mono">${esc(i.latest_rev || "—")}</td><td>${i.latest_status ? badge(i.latest_status) : "—"}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No items yet${canEdit() ? " — add one above." : "."}</div>`;
  $("#i_list").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => itemDetail(tr.dataset.id));
}

async function itemDetail(id) {
  const d = await api("/items/" + id);
  const latest = d.revisions[d.revisions.length - 1];
  main().innerHTML = `<span class="back" id="back">← Items</span>
    <div class="page-h"><div><h2>${esc(d.item.number)} — ${esc(d.item.name)}</h2>
      <div class="sub">${esc(d.item.description || "")} ${d.item.uom ? "· " + esc(d.item.uom) : ""}</div></div>
      ${canEdit() ? `<button class="btn" id="revise">Revise → new working copy</button>` : ""}</div>
    <div class="grid2">
      <div class="card"><div class="card-h">Revisions</div><div>
        <table><thead><tr><th>Rev</th><th>Status</th><th>Released</th></tr></thead><tbody>
        ${d.revisions.map((r) => `<tr data-rev="${r.id}" class="click"><td class="mono">${esc(r.rev)}</td><td>${badge(r.status)}</td>
          <td class="muted">${r.released_at ? new Date(r.released_at).toLocaleDateString() : "—"}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="card"><div class="card-h">Where used</div><div>
        ${d.whereUsed.length ? `<table><tbody>${d.whereUsed.map((w) => `<tr><td class="mono">${esc(w.number)}</td><td>${esc(w.name)}</td><td class="mono">rev ${esc(w.rev)}</td></tr>`).join("")}</tbody></table>`
          : `<div class="empty">Not used in any BOM.</div>`}</div></div>
    </div>
    <div class="card"><div class="card-h">BOM — rev ${esc(latest.rev)} ${badge(latest.status)}</div><div class="card-b" id="bomwrap"></div></div>
    <div class="card"><div class="card-h">Vendor parts</div><div id="vpwrap"></div></div>`;
  $("#back").onclick = viewItems;
  if (canEdit()) $("#revise").onclick = async () => {
    try { const r = await api("/items/" + id + "/revise", { method: "POST" }); flash("Created working rev " + r.revision.rev + "."); itemDetail(id); }
    catch (e) { flash(e.message, "err"); }
  };
  renderBom(latest, id);
  renderVendorParts(d.vendorParts);
}

async function renderBom(rev, itemId) {
  const { lines } = await api("/revisions/" + rev.id + "/bom");
  const editable = canEdit() && rev.status !== "released";
  $("#bomwrap").innerHTML = `
    ${lines.length ? `<table><thead><tr><th>Child</th><th>Name</th><th>Qty</th><th>Ref des</th>${editable ? "<th></th>" : ""}</tr></thead><tbody>
      ${lines.map((l) => `<tr><td class="mono">${esc(l.child_number)}</td><td>${esc(l.child_name)}</td><td>${esc(l.qty)}</td><td class="muted">${esc(l.ref_des || "")}</td>
        ${editable ? `<td><button class="btn danger sm" data-del="${l.id}">remove</button></td>` : ""}</tr>`).join("")}
    </tbody></table>` : `<div class="empty">No components on this revision.</div>`}
    ${editable ? `<div class="inline-form" style="margin-top:14px">
      <div class="field"><label>Child item #</label><input id="b_child" placeholder="40-1180"></div>
      <div class="field"><label>Qty</label><input id="b_qty" value="1" style="width:80px"></div>
      <div class="field"><label>Ref des</label><input id="b_ref" placeholder="R1, R2"></div>
      <button class="btn" id="b_add">Add component</button></div>`
    : rev.status === "released" ? `<div class="note">This revision is released and locked. Use “Revise” to make changes.</div>` : ""}`;
  if (editable) {
    $("#b_add").onclick = async () => {
      try { await api("/revisions/" + rev.id + "/bom", { method: "POST", body: { childNumber: $("#b_child").value, qty: $("#b_qty").value, refDes: $("#b_ref").value } });
        renderBom(rev, itemId); } catch (e) { flash(e.message, "err"); }
    };
    $("#bomwrap").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      try { await api("/bom/" + b.dataset.del, { method: "DELETE" }); renderBom(rev, itemId); } catch (e) { flash(e.message, "err"); }
    });
  }
}

function renderVendorParts(vps) {
  $("#vpwrap").innerHTML = vps.length ? `<table><thead><tr><th>Vendor</th><th>Vendor P/N</th><th>Price</th></tr></thead><tbody>
    ${vps.map((v) => `<tr><td>${esc(v.vendor_code)} — ${esc(v.vendor_name)}</td><td class="mono">${esc(v.vendor_part_number)}</td><td>$${esc(v.price)}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No vendor parts linked. Link them from the Vendors tab.</div>`;
}

// ---------------- ECOs ----------------
async function viewEcos() {
  main().innerHTML = `<div class="page-h"><div><h2>Engineering Change Orders</h2><div class="sub">Route changes through your approval workflow; release on implement.</div></div></div>
    ${canEdit() ? `<div class="card"><div class="card-h">New ECO</div><div class="card-b"><div class="inline-form">
      <div class="field"><label>Number</label><input id="e_num" placeholder="ECO-1042"></div>
      <div class="field"><label>Title</label><input id="e_title" placeholder="Update bracket material"></div>
      <button class="btn" id="e_add">Create ECO</button></div></div></div>` : ""}
    <div class="card"><div class="card-h">All ECOs</div><div id="e_list"></div></div>`;
  if (canEdit()) $("#e_add").onclick = async () => {
    try { const r = await api("/ecos", { method: "POST", body: { number: $("#e_num").value, title: $("#e_title").value } }); flash("ECO created."); ecoDetail(r.eco.id); }
    catch (e) { flash(e.message, "err"); }
  };
  const { ecos } = await api("/ecos");
  $("#e_list").innerHTML = ecos.length ? `<table><thead><tr><th>Number</th><th>Title</th><th>Status</th></tr></thead><tbody>
    ${ecos.map((e) => `<tr class="click" data-id="${e.id}"><td class="mono">${esc(e.number)}</td><td>${esc(e.title)}</td><td>${badge(e.status)}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No change orders yet.</div>`;
  $("#e_list").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => ecoDetail(tr.dataset.id));
}

async function ecoDetail(id) {
  const d = await api("/ecos/" + id);
  const e = d.eco;
  const stepEls = d.steps.map((s) => {
    const cls = e.status === "implemented" || s.seq < e.current_seq ? "done" : (s.seq === e.current_seq && e.status === "in_review" ? "cur" : "");
    return `<span class="step ${cls}">${s.seq}. ${esc(s.name)} <span class="muted mono">(${esc(s.role)})</span></span>`;
  }).join('<span class="arrow">→</span>');

  const canDecide = e.status === "in_review" && d.pendingStep && (ME.role === d.pendingStep.role || ME.role === "admin");

  main().innerHTML = `<span class="back" id="back">← Change Orders</span>
    <div class="page-h"><div><h2>${esc(e.number)} — ${esc(e.title)} ${badge(e.status)}</h2>
      <div class="sub">${esc(e.description || "")}</div></div></div>
    <div class="card"><div class="card-h">Approval route</div><div class="card-b"><div class="steps">${stepEls || '<span class="muted">No workflow configured.</span>'}</div></div></div>

    <div class="card"><div class="card-h">Affected items</div><div class="card-b" id="aff"></div></div>

    ${canDecide ? `<div class="card"><div class="card-h">Your decision — ${esc(d.pendingStep.name)}</div><div class="card-b">
      <div class="field"><label>Disposition</label><input id="disp" placeholder="e.g. Use-as-is, Rework, Scrap"></div>
      <div class="field"><label>Comment</label><textarea id="cmt" rows="2"></textarea></div>
      <div class="row"><button class="btn" id="approve">Approve step</button><button class="btn danger" id="reject">Reject ECO</button></div>
    </div></div>` : ""}

    <div class="card"><div class="card-h">Approval history</div><div id="hist"></div></div>`;
  $("#back").onclick = viewEcos;

  // affected items
  const draft = e.status === "draft" && canEdit();
  $("#aff").innerHTML = `
    ${d.affected.length ? `<table><thead><tr><th>Item</th><th>Name</th><th>Rev</th><th>Status</th></tr></thead><tbody>
      ${d.affected.map((a) => `<tr><td class="mono">${esc(a.number)}</td><td>${esc(a.name)}</td><td class="mono">${esc(a.rev)}</td><td>${badge(a.status)}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No affected items yet.</div>`}
    ${draft ? `<div class="inline-form" style="margin-top:14px">
      <div class="field"><label>Add working revision (item number)</label><input id="aff_num" placeholder="40-1180"></div>
      <button class="btn ghost" id="aff_add">Add affected item</button>
      <button class="btn" id="submit">Submit for approval →</button></div>
      <div class="note">Adds the item's current working revision. Submitting moves it into review and locks editing.</div>` : ""}`;
  if (draft) {
    $("#aff_add").onclick = async () => {
      try {
        const items = await api("/items"); const it = items.items.find((x) => x.number === $("#aff_num").value.trim());
        if (!it) throw new Error("No item with that number.");
        const full = await api("/items/" + it.id); const work = full.revisions.filter((r) => r.status === "working").pop();
        if (!work) throw new Error("That item has no working revision to change.");
        await api("/ecos/" + id + "/affected", { method: "POST", body: { revisionId: work.id } });
        ecoDetail(id);
      } catch (e2) { flash(e2.message, "err"); }
    };
    $("#submit").onclick = async () => { try { await api("/ecos/" + id + "/submit", { method: "POST" }); flash("Submitted for approval."); ecoDetail(id); } catch (e2) { flash(e2.message, "err"); } };
  }

  if (canDecide) {
    $("#approve").onclick = async () => {
      try { const r = await api("/ecos/" + id + "/decide", { method: "POST", body: { decision: "approve", disposition: $("#disp").value, comment: $("#cmt").value } });
        flash(r.result === "implemented" ? "ECO implemented — affected revisions released." : r.result === "advanced" ? "Approved — advanced to: " + r.nextStep : "Approved.");
        ecoDetail(id); } catch (e2) { flash(e2.message, "err"); }
    };
    $("#reject").onclick = async () => {
      try { await api("/ecos/" + id + "/decide", { method: "POST", body: { decision: "reject", disposition: $("#disp").value, comment: $("#cmt").value } });
        flash("ECO rejected — revisions returned to working.", "err"); ecoDetail(id); } catch (e2) { flash(e2.message, "err"); }
    };
  }

  $("#hist").innerHTML = d.approvals.length ? `<table><thead><tr><th>Step</th><th>Decision</th><th>Disposition</th><th>By</th><th>When</th></tr></thead><tbody>
    ${d.approvals.map((a) => `<tr><td>${esc(a.seq)}</td><td>${a.decision === "approve" ? "✓ approve" : "✗ reject"}</td>
      <td>${esc(a.disposition || "")}</td><td>${esc(a.approver_name || "")}</td><td class="muted">${new Date(a.decided_at).toLocaleString()}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No decisions yet.</div>`;
}

// ---------------- VENDORS ----------------
async function viewVendors() {
  main().innerHTML = `<div class="page-h"><div><h2>Vendors</h2><div class="sub">Suppliers and the parts they provide.</div></div></div>
    ${canEdit() ? `<div class="grid2">
      <div class="card"><div class="card-h">New vendor</div><div class="card-b">
        <div class="field"><label>Code</label><input id="v_code" placeholder="ACME"></div>
        <div class="field"><label>Name</label><input id="v_name" placeholder="Acme Components"></div>
        <div class="field"><label>Contact</label><input id="v_contact" placeholder="sales@acme.com"></div>
        <button class="btn" id="v_add">Add vendor</button></div></div>
      <div class="card"><div class="card-h">Link a vendor part</div><div class="card-b">
        <div class="field"><label>Vendor</label><select id="vp_vendor"></select></div>
        <div class="field"><label>Item number</label><input id="vp_item" placeholder="40-1180"></div>
        <div class="field"><label>Vendor P/N</label><input id="vp_pn" placeholder="ACM-55-12"></div>
        <div class="field"><label>Price</label><input id="vp_price" value="0" style="width:120px"></div>
        <button class="btn" id="vp_add">Link part</button></div></div>
    </div>` : ""}
    <div class="card"><div class="card-h">All vendors</div><div id="v_list"></div></div>`;
  const { vendors } = await api("/vendors");
  $("#v_list").innerHTML = vendors.length ? `<table><thead><tr><th>Code</th><th>Name</th><th>Contact</th></tr></thead><tbody>
    ${vendors.map((v) => `<tr><td class="mono">${esc(v.code)}</td><td>${esc(v.name)}</td><td class="muted">${esc(v.contact || "")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No vendors yet.</div>`;
  if (canEdit()) {
    $("#vp_vendor").innerHTML = vendors.map((v) => `<option value="${v.id}">${esc(v.code)} — ${esc(v.name)}</option>`).join("");
    $("#v_add").onclick = async () => { try { await api("/vendors", { method: "POST", body: { code: $("#v_code").value, name: $("#v_name").value, contact: $("#v_contact").value } }); flash("Vendor added."); viewVendors(); } catch (e) { flash(e.message, "err"); } };
    $("#vp_add").onclick = async () => { try { await api("/vendor-parts", { method: "POST", body: { vendorId: $("#vp_vendor").value, itemNumber: $("#vp_item").value, vendorPartNumber: $("#vp_pn").value, price: $("#vp_price").value } }); flash("Vendor part linked."); } catch (e) { flash(e.message, "err"); } };
  }
}

// ---------------- SEARCH ----------------
async function viewSearch() {
  main().innerHTML = `<div class="page-h"><div><h2>AI Search</h2><div class="sub">Ask in plain English across parts and vendors.</div></div></div>
    <div class="card"><div class="card-b">
      <div class="searchbar"><input id="q" placeholder="e.g. released brackets, or aluminum parts measured in EA"><button class="btn" id="s_go">Search</button></div>
      <div class="modehint">${META.aiEnabled ? `<span class="ai-on">● AI search on</span> — queries are interpreted by the model.` : `<span class="ai-off">● Keyword mode</span> — set OPENAI_API_KEY to enable AI interpretation.`}</div>
    </div></div>
    <div class="card"><div class="card-h">Results</div><div id="s_res"><div class="empty">Type a query above.</div></div></div>`;
  const run = async () => {
    const q = $("#q").value.trim(); if (!q) return;
    $("#s_res").innerHTML = `<div class="empty">Searching…</div>`;
    try {
      const d = await api("/search?q=" + encodeURIComponent(q));
      if (!d.results.length) { $("#s_res").innerHTML = `<div class="empty">No matches. <span class="muted">(${d.mode} mode)</span></div>`; return; }
      if (d.entity === "vendors") {
        $("#s_res").innerHTML = `<table><thead><tr><th>Code</th><th>Name</th><th>Contact</th></tr></thead><tbody>
          ${d.results.map((v) => `<tr><td class="mono">${esc(v.code)}</td><td>${esc(v.name)}</td><td class="muted">${esc(v.contact || "")}</td></tr>`).join("")}</tbody></table>
          <div class="note">Interpreted as a vendor search · ${esc(d.mode)} mode.</div>`;
      } else {
        $("#s_res").innerHTML = `<table><thead><tr><th>Number</th><th>Name</th><th>UoM</th><th>Latest status</th></tr></thead><tbody>
          ${d.results.map((i) => `<tr class="click" data-id="${i.id}"><td class="mono">${esc(i.number)}</td><td>${esc(i.name)}</td><td>${esc(i.uom)}</td><td>${i.latest_status ? badge(i.latest_status) : "—"}</td></tr>`).join("")}</tbody></table>
          <div class="note">${esc(d.mode)} mode${d.mode === "ai" ? " — interpreted by the model" : ""}.</div>`;
        $("#s_res").querySelectorAll("tr.click").forEach((tr) => tr.onclick = () => itemDetail(tr.dataset.id));
      }
    } catch (e) { $("#s_res").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  $("#s_go").onclick = run;
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

// ---------------- WORKFLOW (admin) ----------------
async function viewWorkflow() {
  const { steps } = await api("/workflow");
  main().innerHTML = `<div class="page-h"><div><h2>ECO Workflow</h2><div class="sub">Define the ordered approval chain. Each step is gated by a role.</div></div></div>
    <div class="card"><div class="card-h">Approval steps</div><div class="card-b">
      <div id="steps"></div>
      <button class="btn ghost sm" id="addstep" style="margin-top:10px">+ Add step</button>
      <div style="margin-top:16px"><button class="btn" id="save">Save workflow</button></div>
      <div class="note">ECOs walk these steps top to bottom. Final approval implements the ECO and releases all affected revisions.</div>
    </div></div>`;
  const ROLES = ["engineer", "approver", "admin", "viewer"];
  let rows = steps.length ? steps.map((s) => ({ name: s.name, role: s.role })) : [{ name: "Engineering review", role: "engineer" }, { name: "Approval", role: "approver" }];
  const draw = () => {
    $("#steps").innerHTML = rows.map((s, i) => `<div class="row" style="margin-bottom:8px" data-i="${i}">
      <div class="field"><label>Step ${i + 1} name</label><input class="s_name" value="${esc(s.name)}"></div>
      <div class="field" style="max-width:180px"><label>Role</label><select class="s_role">${ROLES.map((r) => `<option ${r === s.role ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      <button class="btn danger sm s_del">remove</button></div>`).join("");
    $("#steps").querySelectorAll(".s_del").forEach((b, i) => b.onclick = () => { rows.splice(i, 1); draw(); });
  };
  draw();
  $("#addstep").onclick = () => { rows.push({ name: "New step", role: "approver" }); draw(); };
  $("#save").onclick = async () => {
    const out = [...$("#steps").querySelectorAll("[data-i]")].map((d) => ({ name: d.querySelector(".s_name").value, role: d.querySelector(".s_role").value }));
    try { await api("/workflow", { method: "PUT", body: { steps: out } }); flash("Workflow saved."); } catch (e) { flash(e.message, "err"); }
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
    <div class="card"><div class="card-h">All users</div><div id="u_list"></div></div>`;
  $("#u_add").onclick = async () => {
    try { await api("/users", { method: "POST", body: { name: $("#u_name").value, email: $("#u_email").value, password: $("#u_pass").value, role: $("#u_role").value } }); flash("User added."); viewUsers(); }
    catch (e) { flash(e.message, "err"); }
  };
  const { users } = await api("/users");
  $("#u_list").innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.name)}</td><td class="muted">${esc(u.email)}</td><td>${badge(u.role)}</td></tr>`).join("")}</tbody></table>`;
}

// ---------------- API & TOKENS ----------------
async function viewApi() {
  main().innerHTML = `<div class="page-h"><div><h2>API & Tokens</h2><div class="sub">Integrate other systems with a bearer token.</div></div></div>
    <div class="card"><div class="card-h">Your tokens</div><div class="card-b">
      <div class="inline-form"><div class="field"><label>Token name</label><input id="t_name" placeholder="erp-sync"></div><button class="btn" id="t_add">Generate token</button></div>
      <div id="t_flash"></div><div id="t_list" style="margin-top:12px"></div>
    </div></div>
    <div class="card"><div class="card-h">Published API</div><div class="card-b">
      <p class="muted" style="margin-bottom:10px">Send <span class="mono">Authorization: Bearer &lt;token&gt;</span>. All calls are scoped to your company.</p>
      <div class="code">GET  /api/items                     list items
POST /api/items                     { number, name, uom }
GET  /api/items/:id                 item + revisions + where-used
POST /api/items/:id/revise          new working revision
GET  /api/revisions/:revId/bom      BOM lines
POST /api/revisions/:revId/bom      { childNumber, qty, refDes }
GET  /api/ecos                      list change orders
GET  /api/search?q=...              AI/keyword search</div>
      <div class="note">Example: <span class="mono">curl -H "Authorization: Bearer plm_xxx" https://plm.athenabot.ai/api/items</span></div>
    </div></div>`;
  $("#t_add").onclick = async () => {
    try { const r = await api("/tokens", { method: "POST", body: { name: $("#t_name").value } });
      $("#t_flash").innerHTML = `<div class="tokenflash">${esc(r.token)} <div class="note">${esc(r.note)}</div></div>`; loadTokens(); }
    catch (e) { flash(e.message, "err"); }
  };
  loadTokens();
}
async function loadTokens() {
  const { tokens } = await api("/tokens");
  $("#t_list").innerHTML = tokens.length ? `<table><thead><tr><th>Name</th><th>Created</th></tr></thead><tbody>
    ${tokens.map((t) => `<tr><td>${esc(t.name)}</td><td class="muted">${new Date(t.created_at).toLocaleString()}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">No tokens yet.</div>`;
}
