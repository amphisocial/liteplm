-- Lite-PLM schema. Multi-tenant: every business table carries company_id and is
-- always queried with it. Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS companies (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'engineer',   -- admin | engineer | approver | viewer
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id),
  number       TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  uom          TEXT DEFAULT 'EA',
  created_by   BIGINT REFERENCES users(id),
  updated_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE IF NOT EXISTS item_revisions (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id),
  item_id      BIGINT NOT NULL REFERENCES items(id),
  rev          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'working',   -- working | in_review | released | obsolete
  lifecycle    TEXT NOT NULL DEFAULT 'Production', -- Prototype | Preproduction | Production
  part_type    TEXT NOT NULL DEFAULT 'Make',       -- Make | Buy
  description  TEXT DEFAULT '',
  notes        TEXT DEFAULT '',
  released_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_id, rev)
);

-- A BOM line attaches a child item to a parent item REVISION.
CREATE TABLE IF NOT EXISTS bom_lines (
  id             BIGSERIAL PRIMARY KEY,
  company_id     BIGINT NOT NULL REFERENCES companies(id),
  parent_rev_id  BIGINT NOT NULL REFERENCES item_revisions(id),
  child_item_id  BIGINT NOT NULL REFERENCES items(id),
  child_rev_id   BIGINT REFERENCES item_revisions(id),
  qty            NUMERIC NOT NULL DEFAULT 1,
  ref_des        TEXT DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  contact     TEXT DEFAULT '',
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS vendor_parts (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id),
  vendor_id           BIGINT NOT NULL REFERENCES vendors(id),
  item_id             BIGINT REFERENCES items(id),
  item_revision_id    BIGINT REFERENCES item_revisions(id),
  vendor_part_number  TEXT NOT NULL,
  price               NUMERIC DEFAULT 0
);

-- Admin-configurable ECO approval chain: ordered steps, each gated by a role.
CREATE TABLE IF NOT EXISTS eco_workflow_steps (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  seq         INT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL                    -- which role approves this step
);

CREATE TABLE IF NOT EXISTS ecos (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  number        TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  reason        TEXT DEFAULT '',                -- supplier obsolescence | design flaw | cost reduction | documentation | other
  impact_class  TEXT DEFAULT 'Class 1',         -- Class 1 (major) | Class 2 (minor)
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | in_progress | released
  current_seq   INT NOT NULL DEFAULT 0,         -- which workflow step is pending
  created_by    BIGINT REFERENCES users(id),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ,                    -- first submit (cycle-time start)
  released_at   TIMESTAMPTZ,                    -- final approval (cycle-time end)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- chronological audit trail for an ECO
CREATE TABLE IF NOT EXISTS eco_events (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  eco_id      BIGINT NOT NULL REFERENCES ecos(id),
  type        TEXT NOT NULL,                    -- created | edited | submitted | resubmitted | approved | rejected | released
  seq         INT,
  step_name   TEXT,
  step_role   TEXT,
  user_id     BIGINT REFERENCES users(id),
  comment     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eco_affected (
  id               BIGSERIAL PRIMARY KEY,
  company_id       BIGINT NOT NULL REFERENCES companies(id),
  eco_id           BIGINT NOT NULL REFERENCES ecos(id),
  item_revision_id BIGINT NOT NULL REFERENCES item_revisions(id),
  disposition      TEXT DEFAULT 'Use As Is',     -- Use As Is | Rework | Scrap
  eff_date         DATE,
  eff_unit         TEXT DEFAULT '',
  eff_batch        TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS eco_approvals (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id),
  eco_id       BIGINT NOT NULL REFERENCES ecos(id),
  seq          INT NOT NULL,
  decision     TEXT NOT NULL,                  -- approve | reject
  disposition  TEXT DEFAULT '',
  comment      TEXT DEFAULT '',
  approver_id  BIGINT REFERENCES users(id),
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_co     ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_revs_item    ON item_revisions(company_id, item_id);
CREATE INDEX IF NOT EXISTS idx_bom_parent   ON bom_lines(company_id, parent_rev_id);
CREATE INDEX IF NOT EXISTS idx_bom_child    ON bom_lines(company_id, child_item_id);
CREATE INDEX IF NOT EXISTS idx_ecos_co      ON ecos(company_id);

-- migrations for already-deployed databases (no-ops on a fresh schema)
ALTER TABLE vendor_parts ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE vendor_parts ADD COLUMN IF NOT EXISTS item_revision_id BIGINT REFERENCES item_revisions(id);
ALTER TABLE bom_lines    ADD COLUMN IF NOT EXISTS child_rev_id BIGINT REFERENCES item_revisions(id);
ALTER TABLE item_revisions ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'Production';
ALTER TABLE item_revisions ADD COLUMN IF NOT EXISTS part_type TEXT NOT NULL DEFAULT 'Make';
ALTER TABLE item_revisions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE ecos ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '';
ALTER TABLE ecos ADD COLUMN IF NOT EXISTS impact_class TEXT DEFAULT 'Class 1';
ALTER TABLE eco_affected ADD COLUMN IF NOT EXISTS disposition TEXT DEFAULT 'Use As Is';
ALTER TABLE eco_affected ADD COLUMN IF NOT EXISTS eff_date DATE;
ALTER TABLE eco_affected ADD COLUMN IF NOT EXISTS eff_unit TEXT DEFAULT '';
ALTER TABLE eco_affected ADD COLUMN IF NOT EXISTS eff_batch TEXT DEFAULT '';
-- map legacy ECO statuses to the new lifecycle
UPDATE ecos SET status='in_progress' WHERE status='in_review';
UPDATE ecos SET status='released' WHERE status IN ('approved','implemented');
ALTER TABLE items ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id);
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ecos ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id);
ALTER TABLE ecos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ecos ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE ecos ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_bom_childrev ON bom_lines(company_id, child_rev_id);
CREATE INDEX IF NOT EXISTS idx_vp_rev       ON vendor_parts(company_id, item_revision_id);
CREATE INDEX IF NOT EXISTS idx_eco_events   ON eco_events(company_id, eco_id, id);
