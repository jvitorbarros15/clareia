package server_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

const (
	dep493  = "220559"
	dep180  = "230765"
	depNone = "74140"
)

func loaded(t *testing.T) (*env, string) {
	t.Helper()
	e := newEnv(t)
	dir := fixtureDir(t)
	e.load(t, dir)
	return e, filepath.Base(dir)
}

type page struct {
	Publication string            `json:"publication"`
	DeputyID    int               `json:"deputyId"`
	Expenses    []json.RawMessage `json:"expenses"`
	NextCursor  *string           `json:"nextCursor"`
}

func walk(t *testing.T, e *env, id, extra string, limit int) []json.RawMessage {
	t.Helper()
	var all []json.RawMessage
	cursor := ""
	for pages := 0; ; pages++ {
		if pages > 1000 {
			t.Fatal("paginação não termina")
		}
		path := "/v1/deputies/" + id + "/expenses?limit=" + strconv.Itoa(limit) + extra
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		r := e.get(t, path)
		if r.status != 200 {
			t.Fatalf("%s: %d %s", path, r.status, r.body)
		}
		var p page
		if err := json.Unmarshal(r.body, &p); err != nil {
			t.Fatal(err)
		}
		all = append(all, p.Expenses...)
		if p.NextCursor == nil {
			return all
		}
		cursor = *p.NextCursor
	}
}

func decode(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestPaginationWalkReturnsEveryRecordOnceInOrder(t *testing.T) {
	e, _ := loaded(t)
	for _, id := range []string{dep493, dep180} {
		want := fixtureRecords(t, id)
		for _, limit := range []int{7, 100, 500} {
			got := walk(t, e, id, "", limit)
			if len(got) != len(want) {
				t.Fatalf("deputado %s limit %d: %d registros, esperado %d", id, limit, len(got), len(want))
			}
			for i := range want {
				if !reflect.DeepEqual(decode(t, got[i]), want[i]) {
					t.Fatalf("deputado %s limit %d: registro %d difere do despesas.json", id, limit, i)
				}
			}
		}
	}
}

func TestFilters(t *testing.T) {
	e, _ := loaded(t)
	recs := fixtureRecords(t, dep493)
	cat := recs[0]["category"].(string)
	wantMonth, wantCat := 0, 0
	for _, r := range recs {
		if r["month"].(float64) == 1 {
			wantMonth++
		}
		if r["category"] == cat {
			wantCat++
		}
	}
	if got := walk(t, e, dep493, "&month=1", 20); len(got) != wantMonth || wantMonth == 0 {
		t.Fatalf("month=1: %d, esperado %d", len(got), wantMonth)
	}
	if got := walk(t, e, dep493, "&category="+url.QueryEscape(cat), 20); len(got) != wantCat {
		t.Fatalf("category: %d, esperado %d", len(got), wantCat)
	}
}

func TestWithoutDataDeputyIsEmptyList(t *testing.T) {
	e, _ := loaded(t)
	r := e.get(t, "/v1/deputies/"+depNone+"/expenses")
	if r.status != 200 {
		t.Fatalf("status %d", r.status)
	}
	m := r.json(t)
	if l, ok := m["expenses"].([]any); !ok || len(l) != 0 || m["nextCursor"] != nil {
		t.Fatalf("esperava lista vazia, veio %s", r.body)
	}
}

func TestSingleExpenseProfileAndLists(t *testing.T) {
	e, pub := loaded(t)
	want := fixtureRecords(t, dep180)[3]
	r := e.get(t, "/v1/expenses/"+want["id"].(string))
	if r.status != 200 {
		t.Fatalf("status %d: %s", r.status, r.body)
	}
	m := r.json(t)
	if !reflect.DeepEqual(m["expense"], any(want)) || m["publication"] != pub {
		t.Fatalf("registro difere: %s", r.body)
	}

	p := e.get(t, "/v1/deputies/"+dep180).json(t)
	held := 0
	for _, x := range p["months"].([]any) {
		mo := x.(map[string]any)
		if mo["held"] == true {
			held++
			if mo["cents"] != nil || mo["reasons"] == nil {
				t.Fatalf("mês retido deve ter cents null e reasons: %v", mo)
			}
		} else if mo["cents"] == nil || mo["reasons"] != nil {
			t.Fatalf("mês normal: %v", mo)
		}
	}
	if held != 2 || len(p["heldMonths"].([]any)) != 2 {
		t.Fatalf("esperava 2 meses retidos, veio %d", held)
	}

	if list := e.get(t, "/v1/deputies").json(t)["deputies"].([]any); len(list) != 3 {
		t.Fatalf("lista com %d deputados", len(list))
	}
	if got := e.get(t, "/v1/deputies?uf=ZZ").json(t)["deputies"].([]any); len(got) != 0 {
		t.Fatalf("uf=ZZ devolveu %d", len(got))
	}
	if meta := e.get(t, "/v1/meta").json(t); meta["publication"] != pub || meta["totalCents"] == nil {
		t.Fatalf("meta: %v", meta)
	}
	if h := e.get(t, "/healthz").json(t); h["publication"] != pub {
		t.Fatalf("healthz: %v", h)
	}
}

func TestErrors(t *testing.T) {
	e, _ := loaded(t)
	missing := strings.Repeat("a", 64)
	cases := []struct {
		method, path string
		status       int
		code         string
	}{
		{"GET", "/v1/deputies/999999999", 404, "not_found"},
		{"GET", "/v1/deputies/999999999/expenses", 404, "not_found"},
		{"GET", "/v1/expenses/" + missing, 404, "not_found"},
		{"GET", "/v1/nada", 404, "not_found"},
		{"GET", "/v1/deputies/abc", 400, "bad_request"},
		{"GET", "/v1/deputies/0", 400, "bad_request"},
		{"GET", "/v1/deputies?uf=x", 400, "bad_request"},
		{"GET", "/v1/deputies/" + dep493 + "/expenses?limit=501", 400, "bad_request"},
		{"GET", "/v1/deputies/" + dep493 + "/expenses?limit=0", 400, "bad_request"},
		{"GET", "/v1/deputies/" + dep493 + "/expenses?month=13", 400, "bad_request"},
		{"GET", "/v1/deputies/" + dep493 + "/expenses?cursor=lixo", 400, "bad_request"},
		{"GET", "/v1/expenses/curto", 400, "bad_request"},
		{"POST", "/v1/meta", 405, "method_not_allowed"},
		{"DELETE", "/v1/deputies/" + dep493, 405, "method_not_allowed"},
	}
	for _, c := range cases {
		r := e.do(t, c.method, c.path)
		if r.status != c.status {
			t.Errorf("%s %s: %d, esperado %d (%s)", c.method, c.path, r.status, c.status, r.body)
			continue
		}
		m := r.json(t)
		if m["error"] != c.code || m["message"] == "" {
			t.Errorf("%s %s: corpo de erro %s", c.method, c.path, r.body)
		}
	}
	if r := e.do(t, http.MethodHead, "/v1/meta"); r.status != 200 || len(r.body) != 0 {
		t.Errorf("HEAD: %d, %d bytes", r.status, len(r.body))
	}
}

func TestETag(t *testing.T) {
	e, pub := loaded(t)
	r := e.get(t, "/v1/deputies/"+dep180)
	tag := r.header.Get("ETag")
	if tag == "" || r.header.Get("Cache-Control") != "public, max-age=300" {
		t.Fatalf("cabeçalhos: %v", r.header)
	}
	if !strings.HasPrefix(tag, `"`+pub+`-test-`) {
		t.Fatalf("ETag %s não começa com publicação e versão", tag)
	}
	if n := e.do(t, "GET", "/v1/deputies/"+dep180, "If-None-Match", tag); n.status != 304 || len(n.body) != 0 {
		t.Fatalf("esperava 304, veio %d", n.status)
	}
	if n := e.do(t, "GET", "/v1/deputies/"+dep180, "If-None-Match", `W/"outro"`); n.status != 200 {
		t.Fatalf("etag diferente deve dar 200, veio %d", n.status)
	}
	if o := e.get(t, "/v1/deputies/"+dep493); o.header.Get("ETag") == tag {
		t.Fatal("rotas diferentes com o mesmo ETag")
	}
	a := e.get(t, "/v1/deputies/"+dep493+"/expenses?limit=5").header.Get("ETag")
	b := e.get(t, "/v1/deputies/"+dep493+"/expenses?limit=6").header.Get("ETag")
	if a == b {
		t.Fatal("queries diferentes com o mesmo ETag")
	}
}

func TestStaleCursorAndPublicationSwitch(t *testing.T) {
	e, a := loaded(t)
	r := e.get(t, "/v1/deputies/"+dep493+"/expenses?limit=10")
	var p page
	if err := json.Unmarshal(r.body, &p); err != nil || p.NextCursor == nil {
		t.Fatalf("sem cursor: %s", r.body)
	}
	oldTag := r.header.Get("ETag")
	b := "bbbbbbbbbbbb"
	e.load(t, fixtureCopy(t, b, "2099-01-01T00:00:00Z"))

	stale := e.get(t, "/v1/deputies/"+dep493+"/expenses?limit=10&cursor="+url.QueryEscape(*p.NextCursor))
	if stale.status != 409 {
		t.Fatalf("esperava 409, veio %d: %s", stale.status, stale.body)
	}
	if m := stale.json(t); m["error"] != "stale_cursor" || m["message"] == "" {
		t.Fatalf("corpo: %s", stale.body)
	}
	fresh := e.get(t, "/v1/deputies/"+dep493+"/expenses?limit=10")
	if fresh.status != 200 || fresh.json(t)["publication"] != b {
		t.Fatalf("o servidor devia passar a servir %s (antes %s): %s", b, a, fresh.body)
	}
	if fresh.header.Get("ETag") == oldTag {
		t.Fatal("ETag não mudou com a publicação")
	}
	if n := e.do(t, "GET", "/v1/deputies/"+dep493+"/expenses?limit=10", "If-None-Match", oldTag); n.status != 200 {
		t.Fatalf("ETag de outra publicação não pode dar 304, veio %d", n.status)
	}
}
