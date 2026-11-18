// Package server is the read-only public API. It only knows the api.* views.
package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultLimit = 100
	maxLimit     = 500
	cacheControl = "public, max-age=300"
)

type Server struct {
	pool    *pgxpool.Pool
	version string
	mux     *http.ServeMux
}

// New builds the handler. version is the binary version and goes into every ETag, so a serialization fix invalidates caches.
func New(pool *pgxpool.Pool, version string) http.Handler {
	s := &Server{pool: pool, version: version, mux: http.NewServeMux()}
	s.route("/healthz", s.healthz)
	s.route("/v1/meta", s.meta)
	s.route("/v1/deputies", s.deputies)
	s.route("/v1/deputies/{id}", s.deputy)
	s.route("/v1/deputies/{id}/expenses", s.expenses)
	s.route("/v1/expenses/{public_id}", s.expense)
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, errNotFound("rota não existe"))
	})
	return s.mux
}

type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.message }

func errNotFound(m string) *apiError   { return &apiError{http.StatusNotFound, "not_found", m} }
func errBadRequest(m string) *apiError { return &apiError{http.StatusBadRequest, "bad_request", m} }

func writeError(w http.ResponseWriter, e *apiError) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(e.status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": e.code, "message": e.message})
}

// handler runs inside one REPEATABLE READ READ ONLY transaction; pub is the active publication of that snapshot.
type handler func(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError)

func (s *Server) route(pattern string, h handler) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeError(w, &apiError{http.StatusMethodNotAllowed, "method_not_allowed", "só GET e HEAD"})
			return
		}
		s.serve(w, r, h)
	})
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request, h handler) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		log.Printf("erro de banco ao abrir transação: %v", err)
		writeError(w, unavailable())
		return
	}
	defer tx.Rollback(context.Background())
	var pub string
	if err := tx.QueryRow(ctx, `SELECT folder_id FROM api.publication`).Scan(&pub); err != nil {
		log.Printf("erro de banco ao ler a publicação ativa: %v", err)
		writeError(w, unavailable())
		return
	}
	cacheable := r.URL.Path != "/healthz"
	if cacheable {
		tag := s.etag(pub, r)
		w.Header().Set("ETag", tag)
		w.Header().Set("Cache-Control", cacheControl)
		if matches(r.Header.Get("If-None-Match"), tag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	body, aerr := h(ctx, tx, r, pub)
	// Free the pool connection before a slow client can hold it while we write.
	_ = tx.Rollback(context.Background())
	if aerr != nil {
		w.Header().Del("ETag")
		writeError(w, aerr)
		return
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		log.Printf("erro ao montar a resposta: %v", err)
		w.Header().Del("ETag")
		writeError(w, &apiError{http.StatusInternalServerError, "internal", "falha ao montar a resposta"})
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
	_, _ = w.Write(buf.Bytes())
}

func unavailable() *apiError {
	return &apiError{http.StatusServiceUnavailable, "unavailable", "sem publicação ativa ou banco indisponível"}
}

// etag = publication + binary version + hash of the path and the canonical query.
func (s *Server) etag(pub string, r *http.Request) string {
	h := sha256.Sum256([]byte(r.URL.Path + "?" + r.URL.Query().Encode()))
	return `"` + pub + "-" + s.version + "-" + hex.EncodeToString(h[:8]) + `"`
}

func matches(header, tag string) bool {
	for _, p := range strings.Split(header, ",") {
		p = strings.TrimPrefix(strings.TrimSpace(p), "W/")
		if p == tag {
			return true
		}
	}
	return false
}

func encodeCursor(pub string, seq int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(pub + ":" + strconv.Itoa(seq)))
}

func decodeCursor(c string) (pub string, seq int, err error) {
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return "", 0, errors.New("cursor inválido")
	}
	p, n, ok := strings.Cut(string(b), ":")
	seq, convErr := strconv.Atoi(n)
	if !ok || convErr != nil || seq < 0 || seq > 1<<31-1 || !folderPattern.MatchString(p) {
		return "", 0, errors.New("cursor inválido")
	}
	return p, seq, nil
}

var (
	folderPattern = regexp.MustCompile(`^[0-9a-f]{12}$`)
	publicID      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	ufPattern     = regexp.MustCompile(`^[A-Za-z]{2}$`)
)

func deputyID(r *http.Request) (int, *apiError) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 || id > 1<<31-1 {
		return 0, errBadRequest("id de deputado inválido")
	}
	return id, nil
}

func opt(q map[string][]string, key string) (string, bool, *apiError) {
	v, ok := q[key]
	if !ok {
		return "", false, nil
	}
	if len(v) != 1 || v[0] == "" || len(v[0]) > 200 {
		return "", false, errBadRequest(fmt.Sprintf("parâmetro %s inválido", key))
	}
	return v[0], true, nil
}
