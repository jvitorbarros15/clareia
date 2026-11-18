package loader_test

import (
	"context"
	"path/filepath"
	"testing"
)

func TestReadOnlyRoleCannotWrite(t *testing.T) {
	e := newEnv(t)
	dir := fixtureDir(t)
	e.load(t, dir)
	ro := e.roConn(t)
	ctx := context.Background()

	var n int
	if err := ro.QueryRow(ctx, `SELECT count(*) FROM api.expenses`).Scan(&n); err != nil || n == 0 {
		t.Fatalf("o papel devia ler api.expenses: %d %v", n, err)
	}
	for _, view := range []string{"deputies", "deputy_months", "deputy_categories", "supplier_cells", "publication"} {
		if err := ro.QueryRow(ctx, `SELECT count(*) FROM api.`+view).Scan(&n); err != nil {
			t.Errorf("api.%s: %v", view, err)
		}
	}

	var ro1, timeout string
	_ = ro.QueryRow(ctx, `SHOW default_transaction_read_only`).Scan(&ro1)
	_ = ro.QueryRow(ctx, `SHOW statement_timeout`).Scan(&timeout)
	if ro1 != "on" || timeout != "15s" {
		t.Errorf("default_transaction_read_only=%s statement_timeout=%s", ro1, timeout)
	}

	denied := map[string]string{
		"INSERT":                     `INSERT INTO api.deputies (id, name) VALUES (1, 'x')`,
		"UPDATE":                     `UPDATE api.deputies SET name = 'x'`,
		"DELETE":                     `DELETE FROM api.expenses`,
		"CREATE TABLE":               `CREATE TABLE api.t (a int)`,
		"CREATE TABLE em public":     `CREATE TABLE public.t (a int)`,
		"CREATE TEMP TABLE":          `CREATE TEMP TABLE t (a int)`,
		"leitura do schema da carga": `SELECT 1 FROM pub_` + filepath.Base(dir) + `.expenses`,
		"api.publications":           `SELECT * FROM api.publications`,
		"DROP VIEW":                  `DROP VIEW api.expenses`,
	}
	for name, sql := range denied {
		if _, err := ro.Exec(ctx, sql); err == nil {
			t.Errorf("%s devia falhar para o papel somente-leitura", name)
		}
	}

	if _, err := ro.Exec(ctx, `SET default_transaction_read_only = off`); err != nil {
		t.Fatal(err)
	}
	if _, err := ro.Exec(ctx, `INSERT INTO api.deputies (id, name) VALUES (1, 'x')`); err == nil {
		t.Error("INSERT depois de desligar o modo somente-leitura devia falhar por falta de privilégio")
	}
	if _, err := ro.Exec(ctx, `CREATE TEMP TABLE t (a int)`); err == nil {
		t.Error("CREATE TEMP TABLE depois de desligar o modo somente-leitura devia falhar por falta de TEMPORARY")
	}
}
