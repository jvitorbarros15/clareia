package loader

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

type Result struct {
	Name   string
	OK     bool
	Detail string
}

type Options struct {
	RoleName     string
	RolePassword string // only Setup uses it
	Out          io.Writer
}

func (o Options) printf(format string, a ...any) {
	if o.Out != nil {
		fmt.Fprintf(o.Out, format, a...)
	}
}

type Report struct {
	FolderID string
	Skipped  string
	Results  []Result
}

func schemaOf(id string) string { return "pub_" + id }

const lockKey = 7415220

// Load puts one publication folder in schema pub_<id>, checks it against the files, and makes it the active one.
func Load(ctx context.Context, conn *pgx.Conn, dir string, o Options) (*Report, error) {
	pub, err := Read(dir)
	if err != nil {
		return nil, err
	}
	rep := &Report{FolderID: pub.FolderID}
	if err := EnsureBase(ctx, conn, o); err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return nil, err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)

	var state *string
	if err := conn.QueryRow(ctx, `SELECT state FROM api.publications WHERE folder_id = $1`, pub.FolderID).Scan(&state); err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	if state != nil && *state == "revoked" {
		return nil, fmt.Errorf("publicação %s foi revogada e não volta", pub.FolderID)
	}
	if state != nil && *state == "retired" {
		return nil, fmt.Errorf("publicação %s já foi substituída e não volta; carregue uma reconstrução nova", pub.FolderID)
	}
	if state == nil {
		if err := refuseOlderThanActive(ctx, conn, pub); err != nil {
			return nil, err
		}
	}
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`, schemaOf(pub.FolderID)).Scan(&exists); err != nil {
		return nil, err
	}
	if string(pub.DomainVersion) == "{}" {
		o.printf("aviso: manifest.json ausente ou sem domínios, domain_versions fica vazio\n")
	}
	if exists {
		if err := ensureSuppliers(ctx, conn, pub.FolderID, state, o); err != nil {
			return nil, fmt.Errorf("tabela suppliers de pub_%s: %w", pub.FolderID, err)
		}
	}
	// A schema exists only if its load committed with every check passed, so it is never dropped or reloaded.
	switch {
	case exists && state != nil:
		rep.Skipped = "já carregada e conferida, estado " + *state
		return rep, nil
	case exists:
		o.printf("pub_%s já conferida mas sem ativação: só ativa\n", pub.FolderID)
	default:
		results, err := loadAndCheck(ctx, conn, pub, o)
		rep.Results = results
		if err != nil {
			return rep, err
		}
	}
	return rep, activate(ctx, conn, pub, o)
}

func loadAndCheck(ctx context.Context, conn *pgx.Conn, pub *Publication, o Options) ([]Result, error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	schema := schemaOf(pub.FolderID)
	if _, err := tx.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('search_path', $1, true)`, schema); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, ddlPublication); err != nil {
		return nil, err
	}
	t := time.Now()
	if err := insertAll(ctx, tx, pub, schema); err != nil {
		return nil, err
	}
	o.printf("carga: %s\n", time.Since(t).Round(time.Millisecond))
	t = time.Now()
	results, err := runChecks(ctx, tx, pub)
	if err != nil {
		return results, err
	}
	o.printf("conferências: %s\n", time.Since(t).Round(time.Millisecond))
	for _, r := range results {
		if !r.OK {
			return results, fmt.Errorf("conferência falhou: %s (%s); nada foi carregado", r.Name, r.Detail)
		}
	}
	return results, tx.Commit(ctx)
}

func jsonOrNil(b json.RawMessage) any {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	return string(b)
}

func insertAll(ctx context.Context, tx pgx.Tx, pub *Publication, schema string) error {
	s, v := pub.Summary, pub.Validation
	published, _ := time.Parse(time.RFC3339, pub.Index.PublishedAt)
	var pubAt any
	if !published.IsZero() {
		pubAt = published
	}
	if _, err := tx.Exec(ctx, `INSERT INTO publication (folder_id, expenses_version, domain_versions, published_at, total_cents, records, min_months, ceiling, limitations, validation)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		pub.FolderID, s.PublicationID, string(pub.DomainVersion), pubAt, s.TotalCents, s.Records, s.MinMonths, jsonOrNil(s.Ceiling), jsonOrNil(v.Limitations), string(pub.Index.Validation)); err != nil {
		return err
	}

	indexOf := map[int]IndexPerson{}
	for _, p := range pub.Index.People {
		indexOf[p.ID] = p
	}
	without := map[int]bool{}
	for _, id := range pub.Index.WithoutData {
		without[id] = true
	}
	reasons := map[[2]int][]string{}
	for _, h := range v.HeldCompetences {
		reasons[[2]int{h.PersonID, h.Month}] = h.Reasons
	}

	var deputies, months, categories [][]any
	for _, p := range s.People {
		ix := indexOf[p.ID]
		held := p.HeldMonths
		if held == nil {
			held = []int{}
		}
		deputies = append(deputies, []any{p.ID, p.Name, ix.UF, ix.UFNote, p.Party, p.PartyNote, p.PartyInReview, p.LastConfirmedParty, ix.Party, p.Photo, ix.SourceURL, p.Comparable, p.ExercisedMonths, p.NoExercise, held, p.Cents, p.Records, without[p.ID]})
		for _, m := range p.Months {
			var cents any = m.Cents
			var why any
			if m.Held {
				cents = nil
				if r, ok := reasons[[2]int{p.ID, m.Month}]; ok {
					b, _ := json.Marshal(r)
					why = string(b)
				}
			}
			values := m.PartyValues
			if values == nil {
				values = []string{}
			}
			vb, _ := json.Marshal(values)
			months = append(months, []any{p.ID, int16(m.Month), cents, m.Records, m.Exercise, m.Party, m.PartyStatus, string(vb), m.UF, m.UFStatus, m.Held, why})
		}
		for _, c := range p.Categories {
			categories = append(categories, []any{p.ID, c.Category, c.Cents, c.Records})
		}
	}
	copyRows := func(table string, cols []string, rows [][]any) error {
		_, err := tx.CopyFrom(ctx, pgx.Identifier{schema, table}, cols, pgx.CopyFromRows(rows))
		return err
	}
	if err := copyRows("deputies", []string{"id", "name", "uf", "uf_note", "party", "party_note", "party_in_review", "last_confirmed_party", "current_party", "photo_url", "source_url", "comparable", "exercised_months", "no_exercise", "held_months", "cents", "records", "without_data"}, deputies); err != nil {
		return fmt.Errorf("deputies: %w", err)
	}
	if err := copyRows("deputy_months", []string{"deputy_id", "month", "cents", "records", "exercise", "party", "party_status", "party_values", "uf", "uf_status", "held", "held_reasons"}, months); err != nil {
		return fmt.Errorf("deputy_months: %w", err)
	}
	if err := copyRows("deputy_categories", []string{"deputy_id", "category", "cents", "records"}, categories); err != nil {
		return fmt.Errorf("deputy_categories: %w", err)
	}

	for _, p := range s.People {
		raws, fields, ok, err := pub.readRecords(p.ID)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		rows := make([][]any, len(raws))
		for i, f := range fields {
			rows[i] = []any{p.ID, int32(i), f.ID, int16(f.Month), f.Category, f.SupplierKey, f.SupplierVerified, f.Cents, string(raws[i])}
		}
		if err := copyRows("expenses", []string{"deputy_id", "seq", "public_id", "month", "category", "supplier_key", "verified", "cents", "record"}, rows); err != nil {
			return fmt.Errorf("despesas de %d: %w", p.ID, err)
		}
	}

	var cells [][]any
	f := pub.Suppliers
	for _, l := range f.Suppliers {
		if len(l) > maxLabelBytes {
			return fmt.Errorf("fornecedores: rótulo de %d bytes passa de %d e quebraria o cursor de /v1/suppliers", len(l), maxLabelBytes)
		}
	}
	ids := make([]string, 0, len(f.People))
	for k := range f.People {
		ids = append(ids, k)
	}
	sort.Strings(ids)
	for _, k := range ids {
		var id int
		if _, err := fmt.Sscan(k, &id); err != nil {
			return fmt.Errorf("fornecedores: pessoa %q", k)
		}
		for _, c := range f.People[k] {
			if c[1] < 0 || int(c[1]) >= len(f.Categories) || c[2] < 0 || int(c[2]) >= len(f.Suppliers) {
				return fmt.Errorf("fornecedores: célula fora dos índices em %s", k)
			}
			cells = append(cells, []any{id, int16(c[0]), f.Categories[c[1]], f.Suppliers[c[2]], nil, c[3], int(c[4])})
		}
	}
	if err := copyRows("supplier_cells", []string{"deputy_id", "month", "category", "label", "supplier_key", "cents", "records"}, cells); err != nil {
		return fmt.Errorf("supplier_cells: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlFillSupplierKeys); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, sqlFillSuppliers)
	return err
}

const sqlFillSuppliers = `
INSERT INTO suppliers (label, supplier_key, verified, total_cents, records, deputies)
SELECT label, supplier_key, supplier_key IS NOT NULL, sum(cents)::bigint, sum(records)::bigint, count(DISTINCT deputy_id)::int
FROM supplier_cells GROUP BY label, supplier_key`

// A label is one supplier: the key of its verified records. Unverified labels keep a NULL key.
const sqlFillSupplierKeys = `
UPDATE supplier_cells c SET supplier_key = k.supplier_key
FROM (SELECT coalesce(record->>'supplierLabel', record->>'supplier') AS label, min(supplier_key) AS supplier_key
      FROM expenses WHERE verified GROUP BY 1) k
WHERE c.label = k.label`

// A folder published before the active one could bring back data a newer publication withheld. Going back is --rollback only.
func refuseOlderThanActive(ctx context.Context, conn *pgx.Conn, pub *Publication) error {
	at, err := time.Parse(time.RFC3339, pub.Index.PublishedAt)
	if err != nil {
		return fmt.Errorf("index.publishedAt inválido: %w", err)
	}
	var activeID string
	if err := conn.QueryRow(ctx, `SELECT folder_id FROM api.publications WHERE state = 'active'`).Scan(&activeID); err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	var activeAt *time.Time
	if err := conn.QueryRow(ctx, `SELECT published_at FROM `+schemaOf(activeID)+`.publication`).Scan(&activeAt); err != nil {
		return fmt.Errorf("a publicação ativa %s está em api.publications mas o schema %s não pôde ser lido (apagado à mão?): %w", activeID, schemaOf(activeID), err)
	}
	if activeAt != nil && at.Before(*activeAt) {
		return fmt.Errorf("publicação %s (publishedAt %s) é mais antiga que a ativa %s (%s): para voltar use --rollback", pub.FolderID, at.Format(time.RFC3339), activeID, activeAt.Format(time.RFC3339))
	}
	return nil
}

// The server caps a query parameter at 200 bytes and the cursor is base64 of "<12 hex>:<label>", so a label over 137 bytes would make its own nextCursor a 400.
const maxLabelBytes = 137

// The suppliers table was added after the first publication was loaded. For an existing schema this creates and fills it from supplier_cells,
// verifies it against them, and (if the publication is the active one) exposes it through api.suppliers, all in one transaction. Idempotent.
func ensureSuppliers(ctx context.Context, conn *pgx.Conn, folderID string, state *string, o Options) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := ensureSuppliersTx(ctx, tx, folderID, state, o); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Same as ensureSuppliers inside the caller's transaction (Rollback uses it before it repoints the views to an older publication).
func ensureSuppliersTx(ctx context.Context, tx pgx.Tx, folderID string, state *string, o Options) error {
	schema := schemaOf(folderID)
	active := state != nil && *state == "active"
	needView := false
	if active {
		// The view was created with SELECT *, so it lacks columns added later and must be recreated.
		if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('api.suppliers') AND attname = 'label_norm' AND NOT attisdropped)`).Scan(&needView); err != nil {
			return err
		}
		if needView {
			// Same lock order as repoint: requests hold api.publication first, so take it before altering suppliers (the reverse order deadlocks).
			if _, err := tx.Exec(ctx, `LOCK TABLE api.publication IN ACCESS EXCLUSIVE MODE`); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('search_path', $1, true)`, schema); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, ddlSuppliers); err != nil {
		return err
	}
	var hasCol bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('suppliers') AND attname = 'label_norm' AND NOT attisdropped)`).Scan(&hasCol); err != nil {
		return err
	}
	if !hasCol {
		if _, err := tx.Exec(ctx, sqlAddLabelNorm); err != nil {
			return err
		}
	}
	var n int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM suppliers`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := tx.Exec(ctx, sqlFillSuppliers); err != nil {
			return err
		}
	}
	var bad int64
	if err := tx.QueryRow(ctx, sqlLabelNorm).Scan(&bad); err != nil {
		return err
	}
	if bad != 0 {
		return fmt.Errorf("%d fornecedores com label_norm diferente da normalização: apague pub_%s.suppliers (DROP TABLE) e rode a carga da pasta de novo", bad, folderID)
	}
	if err := tx.QueryRow(ctx, sqlSuppliersTable).Scan(&bad); err != nil {
		return err
	}
	if bad != 0 {
		return fmt.Errorf("%d fornecedores divergentes de supplier_cells: se a tabela foi alterada à mão, apague pub_%s.suppliers (DROP TABLE) e rode a carga da pasta de novo para refazê-la", bad, folderID)
	}
	if needView {
		if _, err := tx.Exec(ctx, fmt.Sprintf(`DROP VIEW IF EXISTS api.suppliers; CREATE VIEW api.suppliers AS SELECT * FROM %s.suppliers`, schema)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`GRANT SELECT ON api.suppliers TO %s`, pgx.Identifier{roleOf(o)}.Sanitize())); err != nil {
			return err
		}
	}
	return nil
}
