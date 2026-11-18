package loader_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// loadBinary builds cmd/load, so the tests go through the same entry point as the operator.
func loadBinary(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "load.exe")
	out, err := run(t, filepath.Join("..", ".."), filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", bin, "./cmd/load")
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return bin
}

func runLoad(t *testing.T, bin string, e *env, folder string) (string, error) {
	t.Helper()
	cmd := exec.Command(bin, folder)
	cmd.Dir = repoRoot()
	cmd.Env = append(os.Environ(), "CLAREIA_API_DSN="+e.dsn(), "CLAREIA_API_RO_ROLE="+e.role)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func TestCmdLoadGate(t *testing.T) {
	needNode(t)
	e := newEnv(t)
	bin := loadBinary(t)

	t.Run("CPF aborta antes da carga", func(t *testing.T) {
		dir := fixtureCopy(t, "eeeeeeeeeeee")
		editRecords(t, firstExpenses(t, dir), func(recs []map[string]any) { recs[0]["documentNumber"] = validCPF() })
		out, err := runLoad(t, bin, e, mustAbs(t, dir))
		if err == nil || !strings.Contains(out, "busca de CPF falhou") {
			t.Fatalf("cmd/load devia abortar na busca de CPF\n%s", out)
		}
		if e.schemaExists(t, "eeeeeeeeeeee") {
			t.Fatal("o schema foi criado apesar do CPF")
		}
	})

	t.Run("recusa aborta antes da carga", func(t *testing.T) {
		dir := fixtureCopy(t, "000000000000")
		out, err := runLoad(t, bin, e, mustAbs(t, dir))
		if err == nil || !strings.Contains(out, "cinco recusas falhou") {
			t.Fatalf("cmd/load devia abortar nas recusas\n%s", out)
		}
		if e.schemaExists(t, "000000000000") {
			t.Fatal("o schema foi criado apesar da recusa")
		}
	})

	t.Run("pasta válida carrega e ativa", func(t *testing.T) {
		dir := fixtureDir(t)
		out, err := runLoad(t, bin, e, mustAbs(t, dir))
		if err != nil {
			t.Fatalf("a fixture devia carregar: %v\n%s", err, out)
		}
		if got := e.states(t); got != filepath.Base(dir)+"=active" {
			t.Fatalf("estados: %s\n%s", got, out)
		}
	})
}
