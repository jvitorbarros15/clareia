package loader

// label_norm is the label without case or accents, computed once so the search does not translate 21 thousand labels per request.
// It must stay the same expression as norm in internal/server/suppliers.go, which normalizes the search term.
const labelNormExpr = `translate(lower(label), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')`

// The supplier list pre-aggregated from supplier_cells; label is in byte order ("C") so the list order and cursor are stable. Idempotent so existing schemas can get it.
const ddlSuppliers = `
CREATE TABLE IF NOT EXISTS suppliers (
  label text COLLATE "C" PRIMARY KEY,
  supplier_key text,
  verified boolean NOT NULL,
  total_cents bigint NOT NULL,
  records bigint NOT NULL,
  deputies integer NOT NULL,
  label_norm text GENERATED ALWAYS AS (` + labelNormExpr + `) STORED
);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS label_norm text GENERATED ALWAYS AS (` + labelNormExpr + `) STORED;`

// Tables of one publication. Every statement runs with search_path set to pub_<id>.
const ddlPublication = `
CREATE TABLE publication (
  folder_id text PRIMARY KEY,
  expenses_version text NOT NULL,
  domain_versions jsonb NOT NULL,
  published_at timestamptz,
  total_cents bigint NOT NULL,
  records integer NOT NULL,
  min_months integer NOT NULL,
  ceiling jsonb,
  limitations jsonb,
  validation jsonb NOT NULL
);
CREATE TABLE deputies (
  id integer PRIMARY KEY,
  name text NOT NULL,
  uf text,
  uf_note text,
  party text,
  party_note text,
  party_in_review boolean NOT NULL,
  last_confirmed_party text,
  current_party text,
  photo_url text,
  source_url text,
  comparable boolean NOT NULL,
  exercised_months integer NOT NULL,
  no_exercise boolean NOT NULL,
  held_months integer[] NOT NULL,
  cents bigint NOT NULL,
  records integer NOT NULL,
  without_data boolean NOT NULL
);
CREATE TABLE deputy_months (
  deputy_id integer NOT NULL REFERENCES deputies(id),
  month smallint NOT NULL,
  cents bigint,
  records integer NOT NULL,
  exercise text,
  party text,
  party_status text NOT NULL,
  party_values jsonb NOT NULL,
  uf text,
  uf_status text NOT NULL,
  held boolean NOT NULL,
  held_reasons jsonb,
  PRIMARY KEY (deputy_id, month)
);
CREATE TABLE deputy_categories (
  deputy_id integer NOT NULL REFERENCES deputies(id),
  category text NOT NULL,
  cents bigint NOT NULL,
  records integer NOT NULL,
  PRIMARY KEY (deputy_id, category)
);
CREATE TABLE expenses (
  deputy_id integer NOT NULL REFERENCES deputies(id),
  seq integer NOT NULL,
  public_id text NOT NULL UNIQUE,
  month smallint NOT NULL,
  category text NOT NULL,
  supplier_key text,
  verified boolean NOT NULL,
  cents bigint NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (deputy_id, seq)
);
CREATE TABLE supplier_cells (
  deputy_id integer NOT NULL REFERENCES deputies(id),
  month smallint NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  supplier_key text,
  cents bigint NOT NULL,
  records integer NOT NULL,
  PRIMARY KEY (deputy_id, month, category, label)
);
CREATE INDEX ON expenses (supplier_key);
` + ddlSuppliers + `
CREATE INDEX ON supplier_cells (label);
CREATE INDEX supplier_cells_supplier_key_idx ON supplier_cells (supplier_key);
`

// Tables the api views point to. publication goes first: requests hold a lock on api.publication, so activation waits for them before it touches any other view (the reverse order deadlocks).
// suppliers is the supplier list pre-aggregated from supplier_cells, so /v1/suppliers does not aggregate 123 thousand rows per request.
var apiTables = []string{"publication", "expenses", "deputies", "deputy_months", "deputy_categories", "supplier_cells", "suppliers"}

const ddlAPI = `
CREATE SCHEMA IF NOT EXISTS api;
CREATE TABLE IF NOT EXISTS api.publications (
  folder_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('active', 'previous', 'revoked', 'retired')),
  expenses_version text,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  revoked_at timestamptz
);
ALTER TABLE api.publications DROP CONSTRAINT IF EXISTS publications_state_check;
ALTER TABLE api.publications ADD CONSTRAINT publications_state_check CHECK (state IN ('active', 'previous', 'revoked', 'retired'));
`
