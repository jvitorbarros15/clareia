package loader_test

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func needNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("npx"); err != nil {
		skipOrFail(t, "npx não encontrado")
	}
}

// settle names the folder after its recomputed id, so only the tampering under test can be refused.
func settle(t *testing.T, dir string) string {
	t.Helper()
	out, err := run(t, repoRoot(), "npx", "tsx", "api/scripts/folder-id.ts", mustAbs(t, dir))
	if err != nil {
		t.Fatalf("folder-id: %v\n%s", err, out)
	}
	id := strings.TrimSpace(out)
	if !hexName.MatchString(id) {
		t.Fatalf("id inesperado: %q", out)
	}
	dst := filepath.Join(filepath.Dir(dir), id)
	if err := os.Rename(dir, dst); err != nil {
		t.Fatal(err)
	}
	return dst
}

func mustAbs(t *testing.T, p string) string {
	a, err := filepath.Abs(p)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func checkPublication(t *testing.T, dir string) (string, error) {
	return run(t, repoRoot(), "npx", "tsx", "api/scripts/check-publication.ts", mustAbs(t, dir))
}

func TestFixturePassesFiveRefusals(t *testing.T) {
	needNode(t)
	out, err := checkPublication(t, fixtureDir(t))
	if err != nil {
		t.Fatalf("a fixture devia passar: %v\n%s", err, out)
	}
}

func TestFiveRefusals(t *testing.T) {
	needNode(t)
	cases := []struct {
		n      int
		name   string
		mutate func(t *testing.T, dir string) string
	}{
		{1, "nome da pasta diferente do id recalculado", func(t *testing.T, dir string) string {
			dst := filepath.Join(filepath.Dir(dir), "000000000000")
			if err := os.Rename(dir, dst); err != nil {
				t.Fatal(err)
			}
			return dst
		}},
		{2, "schema do summary não aceito", func(t *testing.T, dir string) string {
			editJSON(t, filepath.Join(dir, "summary.json"), func(m map[string]any) { m["schema"] = "clareia.site-summary.v2" })
			return settle(t, dir)
		}},
		{2, "schema de fornecedores não aceito", func(t *testing.T, dir string) string {
			editJSON(t, filepath.Join(dir, "fornecedores.json"), func(m map[string]any) { m["schema"] = "clareia.supplier-summary.v0" })
			return settle(t, dir)
		}},
		{3, "registro não verificado com supplierKey", func(t *testing.T, dir string) string {
			editFirstMatching(t, dir, func(r map[string]any) bool { return r["supplierVerified"] == false }, func(r map[string]any) { r["supplierKey"] = strings.Repeat("a", 64) })
			return settle(t, dir)
		}},
		{3, "registro não verificado com source.sha256", func(t *testing.T, dir string) string {
			editFirstMatching(t, dir, func(r map[string]any) bool { return r["supplierVerified"] == false }, func(r map[string]any) { r["source"].(map[string]any)["sha256"] = strings.Repeat("b", 64) })
			return settle(t, dir)
		}},
		{4, "rótulo genérico com recibo", func(t *testing.T, dir string) string {
			editFirstMatching(t, dir, func(r map[string]any) bool { return r["supplier"] == "Fornecedor pessoa física" }, func(r map[string]any) { r["receipt"] = "https://example.org/recibo" })
			return settle(t, dir)
		}},
		{5, "id do registro não confere com os campos publicados", func(t *testing.T, dir string) string {
			editRecords(t, firstExpenses(t, dir), func(recs []map[string]any) { recs[0]["documentNumber"] = "999999" })
			return settle(t, dir)
		}},
	}
	for _, c := range cases {
		t.Run(fmt.Sprintf("%d %s", c.n, c.name), func(t *testing.T) {
			dir := c.mutate(t, fixtureCopy(t, "dddddddddddd"))
			out, err := checkPublication(t, dir)
			if err == nil {
				t.Fatalf("a pasta devia ser recusada\n%s", out)
			}
			if want := fmt.Sprintf("RECUSA %d:", c.n); !strings.Contains(out, want) {
				t.Fatalf("esperava %q, veio:\n%s", want, out)
			}
		})
	}
}

// validCPF builds a CPF at run time (nine digits plus computed check digits) so no CPF is ever stored in the repo.
func validCPF() string {
	d := []int{5, 2, 9, 9, 8, 2, 2, 4, 7}
	check := func(n int) int {
		sum := 0
		for i := 0; i < n; i++ {
			sum += d[i] * (n + 1 - i)
		}
		r := sum * 10 % 11
		if r == 10 {
			return 0
		}
		return r
	}
	d = append(d, check(9))
	d = append(d, check(10))
	s := ""
	for i, v := range d {
		if i == 3 || i == 6 {
			s += "."
		}
		if i == 9 {
			s += "-"
		}
		s += fmt.Sprint(v)
	}
	return s
}

