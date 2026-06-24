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
