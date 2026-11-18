package loader_test

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"os"
	"path/filepath"
	"testing"

	"github.com/jvitorbarros15/clareia/api/internal/loader"
)

func TestLoadFixture(t *testing.T) {
	e := newEnv(t)
	dir := fixtureDir(t)
	pub, err := loader.Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	rep := e.load(t, dir)
	for _, r := range rep.Results {
		if !r.OK {
			t.Errorf("conferência %q falhou: %s", r.Name, r.Detail)
		}
	}
	if len(rep.Results) < 15 {
		t.Errorf("só %d conferências rodaram", len(rep.Results))
	}
	if got := e.scalar(t, `SELECT count(*) FROM api.expenses`); got != strconv.Itoa(pub.Summary.Records) {
		t.Errorf("api.expenses tem %s linhas, summary diz %d", got, pub.Summary.Records)
	}
	if got := e.states(t); got != pub.FolderID+"=active" {
		t.Errorf("estados: %s", got)
	}

	held := e.scalar(t, `SELECT count(*) FROM api.deputy_months WHERE held AND cents IS NULL AND held_reasons IS NOT NULL`)
	if held != strconv.Itoa(len(pub.Validation.HeldCompetences)) || held == "0" {
		t.Errorf("meses retidos com cents nulo e motivos: %s, esperado %d", held, len(pub.Validation.HeldCompetences))
	}
	for _, id := range pub.Index.WithoutData {
		if n := e.scalar(t, `SELECT count(*) FROM api.expenses WHERE deputy_id = $1`, id); n != "0" {
			t.Errorf("deputado sem dados %d tem %s registros", id, n)
		}
		if w := e.scalar(t, `SELECT without_data FROM api.deputies WHERE id = $1`, id); w != "true" {
			t.Errorf("deputado %d sem marca without_data", id)
		}
	}
	for name, sql := range map[string]string{
		"registro negativo":        `SELECT count(*) FROM api.expenses WHERE cents < 0`,
		"nome retido":              `SELECT count(*) FROM api.expenses WHERE record->>'supplier' = 'Nome não exibido pelo Clareia'`,
		"pessoa física":            `SELECT count(*) FROM api.expenses WHERE record->>'supplier' = 'Fornecedor pessoa física'`,
		"[CPF omitido]":            `SELECT count(*) FROM api.expenses WHERE record::text LIKE '%[CPF omitido]%'`,
		"sinal corrigido":          `SELECT count(*) FROM api.expenses WHERE record ? 'sourceCents'`,
		"fornecedor sem chave":     `SELECT count(*) FROM api.supplier_cells WHERE supplier_key IS NULL`,
		"fornecedor com chave":     `SELECT count(*) FROM api.supplier_cells WHERE supplier_key IS NOT NULL`,
		"não verificado sem chave": `SELECT count(*) FROM api.expenses WHERE NOT verified AND (supplier_key IS NOT NULL OR record ? 'supplierKey')`,
	} {
		n := e.scalar(t, sql)
		if name == "não verificado sem chave" {
			if n != "0" {
				t.Errorf("%s: %s", name, n)
			}
		} else if n == "0" {
			t.Errorf("a fixture não tem %s", name)
		}
	}
	if got := e.scalar(t, `SELECT count(*) FROM api.deputies WHERE uf_note IS NOT NULL`); got == "0" {
		t.Error("a fixture não tem deputado com ufNote")
	}

	again := e.load(t, dir)
	if again.Skipped == "" || len(again.Results) != 0 {
		t.Errorf("segunda carga devia ser no-op, veio %+v", again)
	}
}

func TestLoadedSchemaIsNeverReloaded(t *testing.T) {
	e := newEnv(t)
	dir := fixtureCopy(t, "aaaaaaaaaaaa")
	e.load(t, dir)
	before := e.scalar(t, `SELECT sum(cents) FROM api.expenses`)
	editRecords(t, firstExpenses(t, dir), func(r []map[string]any) { r[0]["cents"] = json.Number("1") })
	if rep := e.load(t, dir); rep.Skipped == "" {
		t.Fatalf("pasta ativa devia ser no-op, veio %+v", rep)
	}
	if got := e.scalar(t, `SELECT sum(cents) FROM api.expenses`); got != before {
		t.Fatalf("a recarga mexeu no schema ativo: %s -> %s", before, got)
	}
}

// Each mutation breaks one thing the checks must notice; the load must fail and leave nothing behind.
func TestChecksRefuseTamperedFolders(t *testing.T) {
	cases := map[string]func(t *testing.T, dir string){
		"valor de um registro": func(t *testing.T, dir string) {
			editRecords(t, firstExpenses(t, dir), func(r []map[string]any) { r[0]["cents"] = json.Number("1") })
		},
		"fornecedor de um registro": func(t *testing.T, dir string) {
			editRecords(t, firstExpenses(t, dir), func(r []map[string]any) { r[0]["supplier"] = "OUTRO FORNECEDOR LTDA"; delete(r[0], "supplierLabel") })
		},
		"despesas de um deputado ausentes": func(t *testing.T, dir string) {
			if err := os.WriteFile(firstExpenses(t, dir), []byte("[]"), 0o644); err != nil {
				t.Fatal(err)
			}
		},
		"total do summary": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "summary.json"), func(m map[string]any) { m["totalCents"] = json.Number("1") })
		},
		"mês retido fora de heldCompetences": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "index.json"), func(m map[string]any) {
				v := m["validation"].(map[string]any)
				v["heldCompetences"] = v["heldCompetences"].([]any)[1:]
			})
		},
		"deputado com dados em withoutData": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "index.json"), func(m map[string]any) {
				m["withoutData"] = append(m["withoutData"].([]any), json.Number(filepath.Base(filepath.Dir(firstExpenses(t, dir)))))
			})
		},
		"rótulo longo demais para o cursor": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "fornecedores.json"), func(m map[string]any) {
				m["suppliers"].([]any)[0] = strings.Repeat("X", 138)
			})
		},
		"célula de fornecedor": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "fornecedores.json"), func(m map[string]any) {
				for _, cells := range m["people"].(map[string]any) {
					if list := cells.([]any); len(list) > 0 {
						list[0].([]any)[3] = json.Number("1")
						return
					}
				}
			})
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			dir := fixtureCopy(t, "cccccccccccc")
			mutate(t, dir)
			_, err := loader.Load(context.Background(), e.conn, dir, e.opts)
			if err == nil {
				t.Fatal("a carga devia falhar")
			}
			t.Log(err)
			if e.schemaExists(t, "cccccccccccc") {
				t.Error("o schema ficou depois da falha")
			}
			if got := e.states(t); got != "" {
				t.Errorf("api.publications devia estar vazia: %s", got)
			}
		})
	}
}

// B is the fixture under another folder name with a visible difference.
func publicationB(t *testing.T, name string) string {
	dir := fixtureCopy(t, name)
	editJSON(t, filepath.Join(dir, "summary.json"), func(m map[string]any) {
		m["people"].([]any)[0].(map[string]any)["name"] = "Nome na publicação " + name
	})
	return dir
}

func TestLifecycleLoadRollbackRevoke(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a := fixtureCopy(t, "aaaaaaaaaaaa")
	b := publicationB(t, "bbbbbbbbbbbb")
	name := func() string { return e.scalar(t, `SELECT name FROM api.deputies ORDER BY id LIMIT 1`) }
	firstA := ""

	e.load(t, a)
	firstA = name()
	e.load(t, b)
	if got := e.states(t); got != "aaaaaaaaaaaa=previous,bbbbbbbbbbbb=active" {
		t.Fatalf("depois de A e B: %s", got)
	}
	if name() != "Nome na publicação bbbbbbbbbbbb" {
		t.Fatalf("as views não apontam para B: %s", name())
	}

	if id, err := loader.Rollback(ctx, e.conn, e.opts); err != nil || id != "aaaaaaaaaaaa" {
		t.Fatalf("rollback: %q %v", id, err)
	}
	if name() != firstA {
		t.Fatalf("depois do rollback o nome devia voltar a %q, veio %q", firstA, name())
	}
	if got := e.states(t); got != "aaaaaaaaaaaa=active,bbbbbbbbbbbb=previous" {
		t.Fatalf("depois do rollback: %s", got)
	}

	if err := loader.Revoke(ctx, e.conn, "aaaaaaaaaaaa"); err == nil {
		t.Fatal("revogar a publicação ativa devia ser recusado")
	}
	if !e.schemaExists(t, "aaaaaaaaaaaa") {
		t.Fatal("a recusa apagou o schema ativo")
	}

	if err := loader.Revoke(ctx, e.conn, "bbbbbbbbbbbb"); err != nil {
		t.Fatal(err)
	}
	if e.schemaExists(t, "bbbbbbbbbbbb") {
		t.Fatal("o schema revogado ainda existe")
	}
	if got := e.states(t); got != "aaaaaaaaaaaa=active,bbbbbbbbbbbb=revoked" {
		t.Fatalf("depois de revogar B: %s", got)
	}
	if _, err := loader.Rollback(ctx, e.conn, e.opts); err == nil {
		t.Fatal("rollback para publicação revogada devia ser recusado")
	}
	if _, err := loader.Load(ctx, e.conn, b, e.opts); err == nil {
		t.Fatal("carregar uma publicação revogada devia ser recusado")
	}
	if name() != firstA {
		t.Fatal("as recusas mexeram nas views")
	}
}

func TestRevokePreviousThenRollbackRefused(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.load(t, fixtureCopy(t, "aaaaaaaaaaaa"))
	e.load(t, publicationB(t, "bbbbbbbbbbbb"))
	if err := loader.Revoke(ctx, e.conn, "aaaaaaaaaaaa"); err != nil {
		t.Fatal(err)
	}
	if e.schemaExists(t, "aaaaaaaaaaaa") {
		t.Fatal("A revogada ainda existe")
	}
	if _, err := loader.Rollback(ctx, e.conn, e.opts); err == nil {
		t.Fatal("rollback para A revogada devia ser recusado")
	}
	if got := e.states(t); got != "aaaaaaaaaaaa=revoked,bbbbbbbbbbbb=active" {
		t.Fatalf("estados: %s", got)
	}
}

func TestOnlyOnePreviousIsKept(t *testing.T) {
	e := newEnv(t)
	e.load(t, fixtureCopy(t, "aaaaaaaaaaaa"))
	e.load(t, publicationB(t, "bbbbbbbbbbbb"))
	e.load(t, publicationB(t, "cccccccccccc"))
	if got := e.states(t); got != "aaaaaaaaaaaa=retired,bbbbbbbbbbbb=previous,cccccccccccc=active" {
		t.Fatalf("estados: %s", got)
	}
	if e.schemaExists(t, "aaaaaaaaaaaa") {
		t.Fatal("a terceira publicação mais antiga devia ter sido apagada")
	}
}

func TestActivationSurvivesChangedViewColumns(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.load(t, fixtureCopy(t, "aaaaaaaaaaaa"))
	if _, err := e.conn.Exec(ctx, `DROP VIEW api.publication; CREATE VIEW api.publication AS SELECT folder_id, 1 AS extra FROM pub_aaaaaaaaaaaa.publication`); err != nil {
		t.Fatal(err)
	}
	e.load(t, publicationB(t, "bbbbbbbbbbbb"))
	if got := e.states(t); got != "aaaaaaaaaaaa=previous,bbbbbbbbbbbb=active" {
		t.Fatalf("estados: %s", got)
	}
}

func TestOlderThanActiveIsRefused(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	at := func(dir, ts string) string {
		editJSON(t, filepath.Join(dir, "index.json"), func(m map[string]any) { m["publishedAt"] = ts })
		return dir
	}
	e.load(t, at(fixtureCopy(t, "aaaaaaaaaaaa"), "2026-06-10T00:00:00Z"))
	if _, err := loader.Load(ctx, e.conn, at(publicationB(t, "bbbbbbbbbbbb"), "2026-06-09T00:00:00Z"), e.opts); err == nil || !strings.Contains(err.Error(), "--rollback") {
		t.Fatalf("publicação mais antiga devia ser recusada: %v", err)
	}
	if e.schemaExists(t, "bbbbbbbbbbbb") || e.states(t) != "aaaaaaaaaaaa=active" {
		t.Fatalf("a recusa deixou rastro: %s", e.states(t))
	}
	e.load(t, at(publicationB(t, "cccccccccccc"), "2026-06-11T00:00:00Z"))
	if _, err := loader.Rollback(ctx, e.conn, e.opts); err != nil {
		t.Fatalf("rollback devia seguir permitido: %v", err)
	}
}

func TestRetiredPublicationCannotComeBack(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a := fixtureCopy(t, "aaaaaaaaaaaa")
	e.load(t, a)
	e.load(t, publicationB(t, "bbbbbbbbbbbb"))
	e.load(t, publicationB(t, "cccccccccccc"))
	if _, err := loader.Load(ctx, e.conn, a, e.opts); err == nil || !strings.Contains(err.Error(), "substituída") {
		t.Fatalf("pasta substituída (mesmo publishedAt) devia ser recusada: %v", err)
	}
	if e.schemaExists(t, "aaaaaaaaaaaa") {
		t.Fatal("a recusa recriou o schema")
	}
	if _, err := e.conn.Exec(ctx, `DELETE FROM api.publications WHERE state = 'active'`); err != nil {
		t.Fatal(err)
	}
	if _, err := loader.Load(ctx, e.conn, a, e.opts); err == nil {
		t.Fatal("sem publicação ativa a pasta substituída ainda devia ser recusada")
	}
}

func TestMissingActiveSchemaGivesClearError(t *testing.T) {
	e := newEnv(t)
	e.load(t, fixtureCopy(t, "aaaaaaaaaaaa"))
	if _, err := e.conn.Exec(context.Background(), `DROP SCHEMA pub_aaaaaaaaaaaa CASCADE`); err != nil {
		t.Fatal(err)
	}
	_, err := loader.Load(context.Background(), e.conn, publicationB(t, "bbbbbbbbbbbb"), e.opts)
	if err == nil || !strings.Contains(err.Error(), "apagado à mão") {
		t.Fatalf("erro devia explicar o schema ausente: %v", err)
	}
}

// A publication loaded before the suppliers table existed gets it, filled and verified, and the api view, on the next (no-op) load.
func TestExistingPublicationGetsSuppliersTable(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	dir := fixtureCopy(t, "aaaaaaaaaaaa")
	e.load(t, dir)
	want := e.scalar(t, `SELECT count(*) FROM pub_aaaaaaaaaaaa.suppliers`)
	if want == "0" {
		t.Fatal("carga nova sem a tabela suppliers preenchida")
	}
	if _, err := e.conn.Exec(ctx, `DROP VIEW api.suppliers; DROP TABLE pub_aaaaaaaaaaaa.suppliers`); err != nil {
		t.Fatal(err)
	}
	if rep := e.load(t, dir); rep.Skipped == "" {
		t.Fatalf("devia ser no-op, veio %+v", rep)
	}
	if got := e.scalar(t, `SELECT count(*) FROM api.suppliers`); got != want {
		t.Fatalf("api.suppliers: %s, esperado %s", got, want)
	}
	ro := e.roConn(t)
	var n int
	if err := ro.QueryRow(ctx, `SELECT count(*) FROM api.suppliers`).Scan(&n); err != nil {
		t.Fatalf("o papel devia ler api.suppliers: %v", err)
	}
	e.load(t, dir)

	if _, err := e.conn.Exec(ctx, `UPDATE pub_aaaaaaaaaaaa.suppliers SET records = records + 1 WHERE label = (SELECT min(label) FROM pub_aaaaaaaaaaaa.suppliers)`); err != nil {
		t.Fatal(err)
	}
	if _, err := loader.Load(ctx, e.conn, dir, e.opts); err == nil || !strings.Contains(err.Error(), "divergentes") {
		t.Fatalf("linha adulterada devia ser recusada: %v", err)
	}
}

// A publication whose suppliers table predates label_norm gets the column and a recreated api.suppliers view on the next (no-op) load.
func TestExistingPublicationGetsLabelNorm(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	dir := fixtureCopy(t, "aaaaaaaaaaaa")
	e.load(t, dir)
	want := e.scalar(t, `SELECT count(*) FROM pub_aaaaaaaaaaaa.suppliers`)
	if _, err := e.conn.Exec(ctx, `DROP VIEW api.suppliers; ALTER TABLE pub_aaaaaaaaaaaa.suppliers DROP COLUMN label_norm; CREATE VIEW api.suppliers AS SELECT * FROM pub_aaaaaaaaaaaa.suppliers`); err != nil {
		t.Fatal(err)
	}
	if rep := e.load(t, dir); rep.Skipped == "" {
		t.Fatalf("devia ser no-op, veio %+v", rep)
	}
	for _, rel := range []string{"pub_aaaaaaaaaaaa.suppliers", "api.suppliers"} {
		if got := e.scalar(t, `SELECT count(*) FROM `+rel+` WHERE label_norm = translate(lower(label), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')`); got != want {
			t.Fatalf("%s: label_norm certo em %s de %s linhas", rel, got, want)
		}
	}
	ro := e.roConn(t)
	var n int
	if err := ro.QueryRow(ctx, `SELECT count(*) FROM api.suppliers WHERE strpos(label_norm, 'a') > 0`).Scan(&n); err != nil {
		t.Fatalf("o papel devia ler label_norm em api.suppliers: %v", err)
	}
}

// A previous publication whose suppliers table exists but predates label_norm can still be rolled back to.
func TestRollbackToPublicationWithoutLabelNorm(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.load(t, fixtureCopy(t, "aaaaaaaaaaaa"))
	e.load(t, publicationB(t, "bbbbbbbbbbbb"))
	want := e.scalar(t, `SELECT count(*) FROM pub_aaaaaaaaaaaa.suppliers`)
	if _, err := e.conn.Exec(ctx, `ALTER TABLE pub_aaaaaaaaaaaa.suppliers DROP COLUMN label_norm`); err != nil {
		t.Fatal(err)
	}
	if id, err := loader.Rollback(ctx, e.conn, e.opts); err != nil || id != "aaaaaaaaaaaa" {
		t.Fatalf("rollback: %q %v", id, err)
	}
	if got := e.scalar(t, `SELECT count(*) FROM api.suppliers WHERE label_norm IS NOT NULL`); got != want {
		t.Fatalf("api.suppliers depois do rollback: %s com label_norm, esperado %s", got, want)
	}
	if got := e.roConn(t).QueryRow(ctx, `SELECT 1 FROM api.suppliers LIMIT 1`).Scan(new(int)); got != nil {
		t.Fatalf("o papel devia ler api.suppliers: %v", got)
	}
}

// A tampered label_norm is refused on the no-op path.
func TestTamperedLabelNormIsRefused(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	dir := fixtureCopy(t, "aaaaaaaaaaaa")
	e.load(t, dir)
	if _, err := e.conn.Exec(ctx, `DROP VIEW api.suppliers; ALTER TABLE pub_aaaaaaaaaaaa.suppliers DROP COLUMN label_norm; ALTER TABLE pub_aaaaaaaaaaaa.suppliers ADD COLUMN label_norm text; UPDATE pub_aaaaaaaaaaaa.suppliers SET label_norm = 'x'`); err != nil {
		t.Fatal(err)
	}
	if _, err := loader.Load(ctx, e.conn, dir, e.opts); err == nil || !strings.Contains(err.Error(), "label_norm") {
		t.Fatalf("label_norm adulterado devia ser recusado: %v", err)
	}
}

// A previous publication loaded before the suppliers table existed can still be rolled back to.
func TestRollbackToPublicationWithoutSuppliersTable(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.load(t, fixtureCopy(t, "aaaaaaaaaaaa"))
	e.load(t, publicationB(t, "bbbbbbbbbbbb"))
	want := e.scalar(t, `SELECT count(*) FROM pub_aaaaaaaaaaaa.suppliers`)
	if _, err := e.conn.Exec(ctx, `DROP TABLE pub_aaaaaaaaaaaa.suppliers`); err != nil {
		t.Fatal(err)
	}
	if id, err := loader.Rollback(ctx, e.conn, e.opts); err != nil || id != "aaaaaaaaaaaa" {
		t.Fatalf("rollback: %q %v", id, err)
	}
	if got := e.scalar(t, `SELECT count(*) FROM api.suppliers`); got != want {
		t.Fatalf("api.suppliers depois do rollback: %s, esperado %s", got, want)
	}
}
