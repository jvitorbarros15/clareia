package server_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jvitorbarros15/clareia/api/internal/loader"
	"github.com/jvitorbarros15/clareia/api/internal/server"
)

const roPassword = "test-ro-password-1"

type env struct {
	conn *pgx.Conn
	opts loader.Options
	url  string
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newEnv gives each test its own database and read-only role, loads the fixture and serves it through httptest.
func newEnv(t *testing.T) *env {
	t.Helper()
	dsn := os.Getenv("CLAREIA_API_TEST_DSN")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("CLAREIA_API_TEST_DSN não definido (obrigatório em CI)")
		}
		t.Skip("CLAREIA_API_TEST_DSN não definido")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	db, role := "api_test_"+randHex(4), "ro_test_"+randHex(4)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		t.Fatal(err)
	}
	cfg := admin.Config().Copy()
	cfg.Database = db
	e := &env{opts: loader.Options{RoleName: role, RolePassword: roPassword}}
	if e.conn, err = pgx.ConnectConfig(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	if err := loader.Setup(ctx, e.conn, e.opts); err != nil {
		t.Fatal(err)
	}
	roCfg, err := pgxpool.ParseConfig("")
	if err != nil {
		t.Fatal(err)
	}
	roCfg.ConnConfig = e.conn.Config().Copy()
	roCfg.ConnConfig.User, roCfg.ConnConfig.Password = role, roPassword
	roCfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, roCfg)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.New(pool, "test"))
	e.url = srv.URL
	t.Cleanup(func() {
		srv.Close()
		pool.Close()
		e.conn.Close(ctx)
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+db+" WITH (FORCE)")
		_, _ = admin.Exec(ctx, "DROP ROLE IF EXISTS "+role)
		admin.Close(ctx)
	})
	return e
}

func (e *env) load(t *testing.T, dir string) {
	t.Helper()
	if _, err := loader.Load(context.Background(), e.conn, dir, e.opts); err != nil {
		t.Fatalf("carga de %s: %v", dir, err)
	}
}

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

// fixtureCopy copies the fixture under another folder name, with a later publishedAt, as a second publication.
func fixtureCopy(t *testing.T, name, publishedAt string) string {
	t.Helper()
	from := fixtureDir(t)
	dst := filepath.Join(t.TempDir(), name)
	err := filepath.Walk(from, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(from, p)
		if info.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dst, rel), b, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dst, "index.json")
	b, _ := os.ReadFile(path)
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		t.Fatal(err)
	}
	m["publishedAt"] = publishedAt
	out, _ := json.Marshal(m)
	if err := os.WriteFile(path, out, 0o644); err != nil {
		t.Fatal(err)
	}
	return dst
}

type resp struct {
	status int
	header http.Header
	body   []byte
}

func (e *env) do(t *testing.T, method, path string, hdr ...string) resp {
	t.Helper()
	req, err := http.NewRequest(method, e.url+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{res.StatusCode, res.Header, b}
}

func (e *env) get(t *testing.T, path string) resp { return e.do(t, http.MethodGet, path) }

func (r resp) json(t *testing.T) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(r.body, &m); err != nil {
		t.Fatalf("resposta não é JSON: %v: %s", err, r.body)
	}
	return m
}

// fixtureRecords reads a deputy's despesas.json from the fixture, as generic values.
func fixtureRecords(t *testing.T, id string) []map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir(t), "deputados", id, "despesas.json"))
	if err != nil {
		t.Fatal(err)
	}
	var recs []map[string]any
	if err := json.Unmarshal(b, &recs); err != nil {
		t.Fatal(err)
	}
	return recs
}
