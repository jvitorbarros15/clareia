package loader_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/jvitorbarros15/clareia/api/internal/loader"
)

const roPassword = "test-ro-password-1"

type env struct {
	conn *pgx.Conn
	role string
	db   string
	opts loader.Options
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newEnv gives each test its own database on the server named by CLAREIA_API_TEST_DSN, so nothing real is touched.
func newEnv(t *testing.T) *env {
	t.Helper()
	dsn := os.Getenv("CLAREIA_API_TEST_DSN")
	if dsn == "" {
		t.Skip("CLAREIA_API_TEST_DSN não definido")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{db: "api_test_" + randHex(4), role: "ro_test_" + randHex(4)}
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+e.db); err != nil {
		t.Fatal(err)
	}
	cfg := admin.Config().Copy()
	cfg.Database = e.db
	e.conn, err = pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	e.opts = loader.Options{RoleName: e.role, RolePassword: roPassword}
	t.Cleanup(func() {
		e.conn.Close(ctx)
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+e.db+" WITH (FORCE)")
		_, _ = admin.Exec(ctx, "DROP ROLE IF EXISTS "+e.role)
		admin.Close(ctx)
	})
	return e
}

func (e *env) roConn(t *testing.T) *pgx.Conn {
	t.Helper()
	cfg := e.conn.Config().Copy()
	cfg.User, cfg.Password = e.role, roPassword
	c, err := pgx.ConnectConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close(context.Background()) })
	return c
}

func (e *env) scalar(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s *string
	if err := e.conn.QueryRow(context.Background(), "SELECT ("+sql+")::text", args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if s == nil {
		return "<null>"
	}
	return *s
}

func (e *env) load(t *testing.T, dir string) *loader.Report {
	t.Helper()
	rep, err := loader.Load(context.Background(), e.conn, dir, e.opts)
	if err != nil {
		t.Fatalf("carga de %s: %v", dir, err)
	}
	return rep
}

func (e *env) states(t *testing.T) string {
	t.Helper()
	rows, err := e.conn.Query(context.Background(), `SELECT folder_id || '=' || state FROM api.publications ORDER BY folder_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		out = append(out, s)
	}
	return strings.Join(out, ",")
}

func (e *env) schemaExists(t *testing.T, id string) bool {
	t.Helper()
	return e.scalar(t, `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)`, "pub_"+id) == "true"
}

func repoRoot() string { return filepath.Join("..", "..", "..") }

var hexName = regexp.MustCompile(`^[0-9a-f]{12}$`)

func fixtureDir(t *testing.T) string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join("..", "..", "testdata"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.IsDir() && hexName.MatchString(e.Name()) {
			return filepath.Join("..", "..", "testdata", e.Name())
		}
	}
	t.Fatal("fixture não encontrada em api/testdata")
	return ""
}

func copyDir(t *testing.T, from, to string) {
	t.Helper()
	err := filepath.Walk(from, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(from, p)
		dst := filepath.Join(to, rel)
		if info.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, b, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// fixtureCopy copies the fixture to a temp folder with the given name, for tests that change it.
func fixtureCopy(t *testing.T, name string) string {
	t.Helper()
	dst := filepath.Join(t.TempDir(), name)
	copyDir(t, fixtureDir(t), dst)
	return dst
}

func editJSON(t *testing.T, path string, f func(m map[string]any)) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		t.Fatal(err)
	}
	f(m)
	out, _ := json.Marshal(m)
	if err := os.WriteFile(path, out, 0o644); err != nil {
		t.Fatal(err)
	}
}

func editRecords(t *testing.T, path string, f func(recs []map[string]any)) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var recs []map[string]any
	if err := dec.Decode(&recs); err != nil {
		t.Fatal(err)
	}
	f(recs)
	out, _ := json.Marshal(recs)
	if err := os.WriteFile(path, out, 0o644); err != nil {
		t.Fatal(err)
	}
}

// firstExpenses returns the despesas.json of the first deputy folder that has one.
func firstExpenses(t *testing.T, dir string) string {
	t.Helper()
	m, _ := filepath.Glob(filepath.Join(dir, "deputados", "*", "despesas.json"))
	if len(m) == 0 {
		t.Fatal("fixture sem despesas")
	}
	return m[0]
}

func run(t *testing.T, dir string, name string, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func jsonNumber(s string) json.Number { return json.Number(s) }

func itoa(n int) string { return strconv.Itoa(n) }

// editFirstMatching changes the first record, across all deputy files, that pred accepts.
func editFirstMatching(t *testing.T, dir string, pred func(r map[string]any) bool, f func(r map[string]any)) {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(dir, "deputados", "*", "despesas.json"))
	for _, file := range files {
		done := false
		editRecords(t, file, func(recs []map[string]any) {
			for _, r := range recs {
				if !done && pred(r) {
					f(r)
					done = true
				}
			}
		})
		if done {
			return
		}
	}
	t.Fatal("a fixture não tem o registro necessário")
}
