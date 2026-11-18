package server_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type supplierRow struct {
	Label      string  `json:"label"`
	Key        *string `json:"key"`
	Verified   bool    `json:"verified"`
	TotalCents int64   `json:"totalCents"`
	Records    int64   `json:"records"`
	Deputies   int     `json:"deputies"`
}

type supplierPage struct {
	Publication string        `json:"publication"`
	Suppliers   []supplierRow `json:"suppliers"`
	NextCursor  *string       `json:"nextCursor"`
}

type fornecedores struct {
	Categories []string               `json:"categories"`
	Suppliers  []string               `json:"suppliers"`
	People     map[string][][]float64 `json:"people"`
}

func readFornecedores(t *testing.T, dir string) fornecedores {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "fornecedores.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fornecedores
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func walkSuppliers(t *testing.T, e *env, extra string, limit int) []supplierRow {
	t.Helper()
	var all []supplierRow
	cursor := ""
	for n := 0; ; n++ {
		if n > 1000 {
			t.Fatal("paginação não termina")
		}
		path := fmt.Sprintf("/v1/suppliers?limit=%d%s", limit, extra)
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		r := e.get(t, path)
		if r.status != 200 {
			t.Fatalf("%s: %d %s", path, r.status, r.body)
		}
		var p supplierPage
		if err := json.Unmarshal(r.body, &p); err != nil {
			t.Fatal(err)
		}
		all = append(all, p.Suppliers...)
		if p.NextCursor == nil {
			return all
		}
		cursor = *p.NextCursor
	}
}

func testCursor(pub, label string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(pub + ":" + label))
}

func TestSuppliersWalkAndDetail(t *testing.T) {
	e, pub := loaded(t)
	f := readFornecedores(t, fixtureDir(t))

	wantTotals := map[string][2]int64{}
	deps := map[string]map[string]bool{}
	for id, cells := range f.People {
		for _, c := range cells {
			l := f.Suppliers[int(c[2])]
			w := wantTotals[l]
			wantTotals[l] = [2]int64{w[0] + int64(c[3]), w[1] + int64(c[4])}
			if deps[l] == nil {
				deps[l] = map[string]bool{}
			}
			deps[l][id] = true
		}
	}

	for _, limit := range []int{1, 7, 500} {
		rows := walkSuppliers(t, e, "", limit)
		if len(rows) != len(wantTotals) {
			t.Fatalf("limit %d: %d rótulos, esperado %d", limit, len(rows), len(wantTotals))
		}
		keyless := 0
		for i, r := range rows {
			if i > 0 && rows[i-1].Label >= r.Label {
				t.Fatalf("limit %d: repetido ou fora de ordem em %q", limit, r.Label)
			}
			w := wantTotals[r.Label]
			if r.TotalCents != w[0] || r.Records != w[1] || r.Deputies != len(deps[r.Label]) {
				t.Fatalf("rótulo %q: %+v, esperado %v e %d deputados", r.Label, r, w, len(deps[r.Label]))
			}
			if (r.Key == nil) == r.Verified {
				t.Fatalf("rótulo %q: key %v e verified %v", r.Label, r.Key, r.Verified)
			}
			if r.Key == nil {
				keyless++
				continue
			}
			if limit != 500 {
				continue
			}
			d := e.get(t, "/v1/suppliers/"+*r.Key)
			if d.status != 200 {
				t.Fatalf("detalhe %q: %d", r.Label, d.status)
			}
			var det struct {
				Publication string `json:"publication"`
				Label       string `json:"label"`
				TotalCents  int64  `json:"totalCents"`
				Records     int64  `json:"records"`
				Deputies    int    `json:"deputies"`
				Cells       []struct {
					Cents   int64 `json:"cents"`
					Records int64 `json:"records"`
				} `json:"cells"`
			}
			if err := json.Unmarshal(d.body, &det); err != nil {
				t.Fatal(err)
			}
			var sc, sr int64
			for _, c := range det.Cells {
				sc += c.Cents
				sr += c.Records
			}
			if det.Publication != pub || det.Label != r.Label || sc != r.TotalCents || sr != r.Records || det.TotalCents != sc || det.Records != sr || det.Deputies != r.Deputies {
				t.Fatalf("detalhe de %q não fecha com a listagem", r.Label)
			}
		}
		if keyless == 0 {
			t.Fatal("a fixture deveria ter rótulos sem chave")
		}
	}
}

func TestSuppliersKeylessAndSearch(t *testing.T) {
	e, _ := loaded(t)
	rows := walkSuppliers(t, e, "&q="+url.QueryEscape("pessoa física"), 500)
	if len(rows) != 1 || rows[0].Key != nil || rows[0].Verified {
		t.Fatalf("esperava um rótulo sem chave para 'pessoa física': %+v", rows)
	}
	for _, q := range []string{"PESSOA FISICA", "pessoa fisica", "Pessoa Física"} {
		if got := walkSuppliers(t, e, "&q="+url.QueryEscape(q), 500); len(got) != 1 || got[0].Label != rows[0].Label {
			t.Fatalf("q=%q: %+v", q, got)
		}
	}
	if got := walkSuppliers(t, e, "&q=zzzzqqq", 10); len(got) != 0 {
		t.Fatalf("busca sem resultado devolveu %d", len(got))
	}
	if r := e.get(t, "/v1/suppliers/"+url.PathEscape(rows[0].Label)); r.status != 400 {
		t.Fatalf("rótulo sem chave usado como chave: %d", r.status)
	}
	if r := e.get(t, "/v1/suppliers/"+strings.Repeat("0", 64)); r.status != 404 {
		t.Fatalf("chave inexistente: %d", r.status)
	}
}

func TestSuppliersErrors(t *testing.T) {
	e, pub := loaded(t)
	for path, want := range map[string]int{
		"/v1/suppliers?q=ab":                       400,
		"/v1/suppliers?q=" + strings.Repeat("a", 101): 400,
		"/v1/suppliers?q=":                         400,
		"/v1/suppliers?q=abc&q=def":                400,
		"/v1/suppliers?limit=0":                    400,
		"/v1/suppliers?limit=501":                  400,
		"/v1/suppliers?cursor=!!":                  400,
		"/v1/suppliers/abc":                        400,
		"/v1/suppliers/" + strings.Repeat("g", 64): 400,
		"/v1/suppliers?q=" + strings.Repeat("á", 100): 200,
		"/v1/suppliers?cursor=" + url.QueryEscape(testCursor(pub, "A")):            200,
		"/v1/suppliers?cursor=" + url.QueryEscape(testCursor("aaaaaaaaaaaa", "A")): 409,
	} {
		if r := e.get(t, path); r.status != want {
			t.Errorf("%s: %d, esperado %d", path, r.status, want)
		}
	}
	r := e.get(t, "/v1/suppliers?limit=1")
	if r.header.Get("ETag") == "" {
		t.Error("sem ETag")
	}
	if r2 := e.do(t, "GET", "/v1/suppliers?limit=1", "If-None-Match", r.header.Get("ETag")); r2.status != 304 {
		t.Errorf("If-None-Match: %d", r2.status)
	}
}

func TestCategoriesSumToTotal(t *testing.T) {
	e, pub := loaded(t)
	r := e.get(t, "/v1/categories")
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	var b struct {
		Publication string `json:"publication"`
		TotalCents  int64  `json:"totalCents"`
		Records     int    `json:"records"`
		Categories  []struct {
			Category string `json:"category"`
			Cents    int64  `json:"cents"`
			Records  int    `json:"records"`
		} `json:"categories"`
	}
	if err := json.Unmarshal(r.body, &b); err != nil {
		t.Fatal(err)
	}
	var sc int64
	var sr int
	for _, c := range b.Categories {
		sc += c.Cents
		sr += c.Records
	}
	meta := e.get(t, "/v1/meta").json(t)
	if b.Publication != pub || sc != b.TotalCents || sr != b.Records || float64(sc) != meta["totalCents"].(float64) {
		t.Fatalf("categorias somam %d/%d, total %d/%d, meta %v", sc, sr, b.TotalCents, b.Records, meta["totalCents"])
	}
	if len(b.Categories) < 2 {
		t.Fatal("poucas categorias")
	}
}
