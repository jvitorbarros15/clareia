package loader

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
  validation jsonb NOT NULL,
  verified boolean NOT NULL DEFAULT false
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
CREATE INDEX ON supplier_cells (label);
`

// Tables the api views point to.
var apiTables = []string{"expenses", "deputies", "deputy_months", "deputy_categories", "supplier_cells", "publication"}

const ddlAPI = `
CREATE SCHEMA IF NOT EXISTS api;
CREATE TABLE IF NOT EXISTS api.publications (
  folder_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('active', 'previous', 'revoked')),
  expenses_version text,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  revoked_at timestamptz
);
`
