package loader_test

import (
	"context"
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
	if got := e.scalar(t, `SELECT count(*) FROM api.expenses`); got != itoa(pub.Summary.Records) {
		t.Errorf("api.expenses tem %s linhas, summary diz %d", got, pub.Summary.Records)
	}
	if got := e.states(t); got != pub.FolderID+"=active" {
		t.Errorf("estados: %s", got)
	}

	held := e.scalar(t, `SELECT count(*) FROM api.deputy_months WHERE held AND cents IS NULL AND held_reasons IS NOT NULL`)
	if held != itoa(len(pub.Validation.HeldCompetences)) || held == "0" {
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

func TestInterruptedLoadIsRedone(t *testing.T) {
	e := newEnv(t)
	dir := fixtureDir(t)
	pub, _ := loader.Read(dir)
	ctx := context.Background()
	if err := loader.EnsureBase(ctx, e.conn, e.opts); err != nil {
		t.Fatal(err)
	}
	if _, err := e.conn.Exec(ctx, `CREATE SCHEMA pub_`+pub.FolderID+`; CREATE TABLE pub_`+pub.FolderID+`.publication (verified boolean); INSERT INTO pub_`+pub.FolderID+`.publication VALUES (false)`); err != nil {
		t.Fatal(err)
	}
	rep := e.load(t, dir)
	if rep.Skipped != "" || len(rep.Results) == 0 {
		t.Fatalf("schema sem a marca devia ser recarregado: %+v", rep)
	}
	if got := e.scalar(t, `SELECT count(*) FROM api.expenses`); got != itoa(pub.Summary.Records) {
		t.Errorf("api.expenses: %s", got)
	}
}

// Each mutation breaks one thing the checks must notice; the load must fail and leave nothing behind.
func TestChecksRefuseTamperedFolders(t *testing.T) {
	cases := map[string]func(t *testing.T, dir string){
		"valor de um registro": func(t *testing.T, dir string) {
			editRecords(t, firstExpenses(t, dir), func(r []map[string]any) { r[0]["cents"] = jsonNumber("1") })
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
			editJSON(t, filepath.Join(dir, "summary.json"), func(m map[string]any) { m["totalCents"] = jsonNumber("1") })
		},
		"mês retido fora de heldCompetences": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "index.json"), func(m map[string]any) {
				v := m["validation"].(map[string]any)
				v["heldCompetences"] = v["heldCompetences"].([]any)[1:]
			})
		},
		"deputado com dados em withoutData": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "index.json"), func(m map[string]any) {
				m["withoutData"] = append(m["withoutData"].([]any), jsonNumber(filepath.Base(filepath.Dir(firstExpenses(t, dir)))))
			})
		},
		"célula de fornecedor": func(t *testing.T, dir string) {
			editJSON(t, filepath.Join(dir, "fornecedores.json"), func(m map[string]any) {
				for _, cells := range m["people"].(map[string]any) {
					if list := cells.([]any); len(list) > 0 {
						list[0].([]any)[3] = jsonNumber("1")
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
	if got := e.states(t); got != "bbbbbbbbbbbb=previous,cccccccccccc=active" {
		t.Fatalf("estados: %s", got)
	}
	if e.schemaExists(t, "aaaaaaaaaaaa") {
		t.Fatal("a terceira publicação mais antiga devia ter sido apagada")
	}
}
