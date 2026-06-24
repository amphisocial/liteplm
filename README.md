# Lite-PLM with AI

Multi-tenant product lifecycle management for small/mid-cap manufacturers.
Items & revisions, BOMs, vendors, a role-based ECO approval workflow that
releases (locks) affected revisions on implement, AI natural-language search,
and a token-authenticated API. No build step — plain Node + Postgres + vanilla JS.

## Run
    npm install
    DATABASE_URL=postgresql://plm:pass@localhost:5432/plm PGSSL=false npm start
    # http://localhost:8080  (or set PORT)

The schema auto-creates on first boot. Sign up to create a company workspace
(first user is admin). Add users with roles: admin, engineer, approver, viewer.

## Roles
- admin     — everything, incl. users + workflow config; can act on any ECO step
- engineer  — create/edit items, BOMs, vendors, ECOs
- approver  — approve/reject ECO steps assigned to the approver role
- viewer    — read only

## ECO flow
draft → add affected working revisions → submit → walks the admin-defined
approval steps (each gated by a role) → final approval **implements** the ECO and
**releases** every affected revision (locked; revise to change).

## AI search
Set OPENAI_API_KEY to interpret plain-English queries; otherwise keyword search.

## API
Generate a token in "API & Tokens", then send `Authorization: Bearer <token>`.
All calls are company-scoped. See the in-app API page for the endpoint list.

## Importing data (Admin → Import / Setup)
- **Load sample catalog** — one click loads a realistic medical-supplier catalog
  (1,200 parts, 3–4 revisions each, 200 multi-level BOMs, 620 commodities with
  1,800+ vendor parts). Wipes existing data first.
- **Import your own CSVs** — upload items / revisions / boms / vendors /
  vendor_parts; files reference each other by part number and vendor code.
  Sample CSVs live in db/samples/medical/ and double as format templates.

## Revisions, attributes & change comparison
- **Lifecycle State** and **Type (Make/Buy)** live on each revision, so they can
  change as a part matures (Prototype → Preproduction → Production). Purchased
  commodities are Buy / Production. Make = blue badge + wrench, Buy = amber + cart,
  shown across the items list, item header, revision table, and BOM rows.
- **Compare two revisions** — select two revisions on an item and click Compare to
  see a BOM redline: Add (new line), Delete (removed line), Update (qty or ref des
  changed, shown X → Y).
- **ECO From → To** — on a change order, "Compare BOMs" redlines each affected
  item from its latest released revision (From) to the working revision (To).

## Release process (Revise vs Release → ECO)
- **Revise** (on a released revision) creates the next letter as a new *working* copy.
  You cannot revise a working revision — release it first.
- **Release → ECO** (on a working revision) opens a change-order form pre-loaded
  with that revision; add more working revisions to mass-release. The form captures
  description, reason (supplier obsolescence / design flaw / cost reduction /
  documentation / other), impact classification, and per-affected inventory
  disposition (Use As Is / Rework / Scrap) and effectivity (date / unit / batch).
- **Impact classification** routes approval: **Class 1 (major)** runs the full
  workflow; **Class 2 (minor)** runs only the first step. On submit the ECO is
  **In Progress**; when the final required step is approved it becomes **Released**
  and every affected revision is released (locked).
- **Edit a working revision** in place: lifecycle (Prototype/Preproduction/
  Production), Make/Buy, and description (description is per revision).

## Audit, drafts & cycle time
- **Drafts** — Release → ECO has **Save draft** and **Submit for review**. A draft can
  be edited (fields and affected items) and submitted when ready.
- **Reject → draft** — rejecting at any step returns the ECO to draft (affected
  revisions go back to working) so it can be edited and resubmitted. The audit keeps
  the full history across rejections and resubmissions.
- **Role gating** — only the role assigned to a workflow step (or an admin) can act on
  it. An approver cannot approve an engineer-role step, and vice versa.
- **Cycle time** — starts at the first submit and ends at release (spanning any
  reject/resubmit). Shown on the ECO's **Audit** tab.
- **Audit tab** — Date Created / Modified, Created / Modified By, Submitted, Final
  Approval, Cycle Time, plus a full chronology (created, submitted, approved/rejected
  per step with approver name, role, comment, timestamp, resubmitted, released).
- **Item audit** — items record Created / Modified date and user, shown on the item page.
