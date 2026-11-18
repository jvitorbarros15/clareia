package loader_test

import (
	"context"
	"testing"

	"github.com/jvitorbarros15/clareia/api/internal/loader"
)

// Each case changes rows inside the transaction, after the insert, and names the check that must catch it.
func TestChecksCatchTamperedRows(t *testing.T) {
	first := `deputy_id = (SELECT min(deputy_id) FROM expenses) AND seq = 0`
	cases := []struct {
		name, sql, check string
		only             bool
	}{
		{"registro lido de volta diferente do arquivo, somas intactas", `UPDATE expenses SET record = record || '{"x":1}' WHERE ` + first, "ida e volta registro a registro", true},
		{"public_id diferente do record", `UPDATE expenses SET public_id = 'zzzz' WHERE ` + first, "colunas de filtro = record", true},
		{"verificado sem supplier_key", `UPDATE expenses SET supplier_key = NULL WHERE ctid = (SELECT ctid FROM expenses WHERE verified LIMIT 1)`, "colunas de filtro = record", false},
		{"verified diferente do record", `UPDATE expenses SET verified = NOT verified WHERE ctid = (SELECT ctid FROM expenses WHERE NOT verified LIMIT 1)`, "colunas de filtro = record", false},
		{"mês retido com registros", `UPDATE deputy_months SET records = 3 WHERE held`, "total por pessoa e mês", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			ctx := context.Background()
			pub, err := loader.Read(fixtureDir(t))
			if err != nil {
				t.Fatal(err)
			}
			tx, err := loader.BeginUnchecked(ctx, e.conn, pub)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)

			base, err := loader.RunChecks(ctx, tx, pub)
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range base {
				if !r.OK {
					t.Fatalf("a fixture sem adulteração devia passar: %s (%s)", r.Name, r.Detail)
				}
			}
			if _, err := tx.Exec(ctx, c.sql); err != nil {
				t.Fatal(err)
			}
			got, err := loader.RunChecks(ctx, tx, pub)
			if err != nil {
				t.Fatal(err)
			}
			caught := false
			for _, r := range got {
				if r.Name == c.check && !r.OK {
					caught = true
				} else if !r.OK && c.only {
					t.Errorf("só %q devia falhar, mas %q também: %s", c.check, r.Name, r.Detail)
				}
			}
			if !caught {
				t.Errorf("a conferência %q devia falhar", c.check)
			}
		})
	}
}
