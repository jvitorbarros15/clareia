package server_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jvitorbarros15/clareia/api/internal/server"
)

// TestContractAgainstRealPublication is local only. It serves the real database through the read-only role and compares every
// response with the built folder. Run with CLAREIA_API_CONTRACT=1, CLAREIA_API_RO_DSN (role clareia_api_ro) and
// CLAREIA_API_CONTRACT_DATA (the data/<id> folder of the active publication). CLAREIA_API_CONTRACT_DUMP, if set, receives
// every response body so scan:cpf can run over it.
func TestContractAgainstRealPublication(t *testing.T) {
	if os.Getenv("CLAREIA_API_CONTRACT") != "1" {
		t.Skip("contrato real só com CLAREIA_API_CONTRACT=1 (local)")
	}
	dir, dsn, dump := os.Getenv("CLAREIA_API_CONTRACT_DATA"), os.Getenv("CLAREIA_API_RO_DSN"), os.Getenv("CLAREIA_API_CONTRACT_DUMP")
	if dir == "" || dsn == "" {
		t.Fatal("defina CLAREIA_API_CONTRACT_DATA e CLAREIA_API_RO_DSN")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal("DSN inválido")
	}
	defer pool.Close()
	srv := httptest.NewServer(server.New(pool, "contract"))
	defer srv.Close()
	e := &env{url: srv.URL}

	save := func(name string, body []byte) {
		if dump == "" {
			return
		}
		p := filepath.Join(dump, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	readJSON := func(path string, v any) {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(b, v); err != nil {
			t.Fatal(err)
		}
	}

	var summary struct {
		TotalCents int64 `json:"totalCents"`
		Records    int   `json:"records"`
		People     []struct {
			ID      int   `json:"id"`
			Cents   int64 `json:"cents"`
			Records int   `json:"records"`
			Months  []struct {
				Month   int   `json:"month"`
				Cents   int64 `json:"cents"`
				Records int   `json:"records"`
				Held    bool  `json:"held"`
			} `json:"months"`
			Categories []struct {
				Category string `json:"category"`
				Cents    int64  `json:"cents"`
				Records  int    `json:"records"`
			} `json:"categories"`
		} `json:"people"`
	}
	var index struct {
		WithoutData []int `json:"withoutData"`
	}
	readJSON(filepath.Join(dir, "summary.json"), &summary)
	readJSON(filepath.Join(dir, "index.json"), &index)
	without := map[int]bool{}
	for _, id := range index.WithoutData {
		without[id] = true
	}
	pub := filepath.Base(dir)

	sp := loadSpec(t)
	conforms := func(route, path string, r resp) {
		var body any
		if err := json.Unmarshal(r.body, &body); err != nil {
			t.Fatal(err)
		}
		if errs := sp.check(path, body, sp.response(route, "get", "200")); len(errs) > 0 {
			t.Fatalf("%s não bate com o openapi.yaml: %s", path, errs[0])
		}
	}
	start := time.Now()
	requests := 0
	get := func(path, dumpName string) resp {
		r := e.get(t, path)
		requests++
		if r.status != 200 {
			t.Fatalf("%s: %d %s", path, r.status, r.body)
		}
		save(dumpName, r.body)
		return r
	}

	meta := get("/v1/meta", "meta.json").json(t)
	if meta["publication"] != pub || int64(meta["totalCents"].(float64)) != summary.TotalCents || int(meta["records"].(float64)) != summary.Records {
		t.Fatalf("meta não bate com a pasta %s: %v", pub, meta)
	}
	list := get("/v1/deputies", "deputies.json").json(t)["deputies"].([]any)
	if len(list) != len(summary.People) {
		t.Fatalf("lista de deputados: %d, esperado %d", len(list), len(summary.People))
	}

	withData, empty, records, heldMonths, singles := 0, 0, 0, 0, 0
	for _, p := range summary.People {
		id := fmt.Sprint(p.ID)

		profResp := get("/v1/deputies/"+id, "deputies/"+id+"/profile.json")
		conforms("/v1/deputies/{id}", "/v1/deputies/"+id, profResp)
		prof := profResp.json(t)
		months := prof["months"].([]any)
		if len(months) != len(p.Months) || int64(prof["totalCents"].(float64)) != p.Cents || int(prof["records"].(float64)) != p.Records {
			t.Fatalf("deputado %s: perfil não bate com summary.json", id)
		}
		for i, sm := range p.Months {
			m := months[i].(map[string]any)
			if int(m["month"].(float64)) != sm.Month || m["held"] != sm.Held || int(m["records"].(float64)) != sm.Records {
				t.Fatalf("deputado %s mês %d: difere de summary.json", id, sm.Month)
			}
			if sm.Held {
				heldMonths++
				if m["cents"] != nil || m["reasons"] == nil {
					t.Fatalf("deputado %s mês %d retido deve ter cents null e reasons", id, sm.Month)
				}
			} else if m["cents"] == nil || int64(m["cents"].(float64)) != sm.Cents {
				t.Fatalf("deputado %s mês %d: cents difere", id, sm.Month)
			}
		}
		cats := prof["categories"].([]any)
		if len(cats) != len(p.Categories) {
			t.Fatalf("deputado %s: %d categorias, esperado %d", id, len(cats), len(p.Categories))
		}
		want := map[string][2]int64{}
		for _, c := range p.Categories {
			want[c.Category] = [2]int64{c.Cents, int64(c.Records)}
		}
		for _, x := range cats {
			c := x.(map[string]any)
			if w := want[c["category"].(string)]; w != [2]int64{int64(c["cents"].(float64)), int64(c["records"].(float64))} {
				t.Fatalf("deputado %s categoria %v difere", id, c["category"])
			}
		}

		var got []json.RawMessage
		cursor := ""
		for n := 0; ; n++ {
			path := "/v1/deputies/" + id + "/expenses?limit=500"
			if cursor != "" {
				path += "&cursor=" + url.QueryEscape(cursor)
			}
			var pg page
			r := get(path, fmt.Sprintf("deputies/%s/expenses-%03d.json", id, n))
			if err := json.Unmarshal(r.body, &pg); err != nil {
				t.Fatal(err)
			}
			conforms("/v1/deputies/{id}/expenses", path, r)
			got = append(got, pg.Expenses...)
			if pg.NextCursor == nil {
				break
			}
			cursor = *pg.NextCursor
		}

		if without[p.ID] {
			if len(got) != 0 {
				t.Fatalf("deputado sem dados %s devolveu %d registros", id, len(got))
			}
			empty++
			continue
		}
		var file []map[string]any
		readJSON(filepath.Join(dir, "deputados", id, "despesas.json"), &file)
		if len(got) != len(file) || len(file) != p.Records {
			t.Fatalf("deputado %s: %d registros pela API, %d no arquivo, %d no summary", id, len(got), len(file), p.Records)
		}
		for i := range file {
			if !reflect.DeepEqual(decode(t, got[i]), file[i]) {
				t.Fatalf("deputado %s posição %d: registro difere do despesas.json", id, i)
			}
		}
		if len(file) > 0 {
			i := len(file) / 2
			r := get("/v1/expenses/"+file[i]["id"].(string), "deputies/"+id+"/single.json")
			if !reflect.DeepEqual(r.json(t)["expense"], any(file[i])) {
				t.Fatalf("deputado %s: /v1/expenses/{id} difere", id)
			}
			singles++
		}
		withData++
		records += len(file)
	}

	// Phase 3: suppliers and categories against fornecedores.json and summary.json.
	f := readFornecedores(t, dir)
	type cellKey struct {
		dep, month int
		cat, label string
	}
	wantCells := map[string]map[cellKey][2]int64{}
	wantTotal := map[string][3]int64{}
	wantDeps := map[string]map[int]bool{}
	fileCells := 0
	for k, cells := range f.People {
		var dep int
		fmt.Sscan(k, &dep)
		for _, c := range cells {
			l := f.Suppliers[int(c[2])]
			ck := cellKey{dep, int(c[0]), f.Categories[int(c[1])], l}
			if wantCells[l] == nil {
				wantCells[l] = map[cellKey][2]int64{}
			}
			wantCells[l][ck] = [2]int64{int64(c[3]), int64(c[4])}
			w := wantTotal[l]
			if wantDeps[l] == nil {
				wantDeps[l] = map[int]bool{}
			}
			wantDeps[l][dep] = true
			wantTotal[l] = [3]int64{w[0] + int64(c[3]), w[1] + int64(c[4]), 0}
			fileCells++
		}
	}
	if len(wantCells) != len(f.Suppliers) {
		t.Fatalf("fornecedores.json repete rótulos: %d distintos de %d", len(wantCells), len(f.Suppliers))
	}
	supStart := time.Now()
	seenLabels, keyedCells, keylessCells, keyless, detailReqs := 0, 0, 0, 0, 0
	cursor := ""
	prevLabel := ""
	for n := 0; ; n++ {
		path := "/v1/suppliers?limit=500"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		r := get(path, fmt.Sprintf("suppliers/list-%03d.json", n))
		conforms("/v1/suppliers", path, r)
		var pg struct {
			Suppliers []struct {
				Label      string  `json:"label"`
				Key        *string `json:"key"`
				Verified   bool    `json:"verified"`
				TotalCents int64   `json:"totalCents"`
				Records    int64   `json:"records"`
				Deputies   int     `json:"deputies"`
			} `json:"suppliers"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(r.body, &pg); err != nil {
			t.Fatal(err)
		}
		for _, s := range pg.Suppliers {
			if prevLabel != "" && prevLabel >= s.Label {
				t.Fatalf("fornecedores fora de ordem ou repetidos em %q", s.Label)
			}
			prevLabel = s.Label
			seenLabels++
			w, ok := wantCells[s.Label]
			if !ok {
				t.Fatalf("rótulo da API que não está no fornecedores.json: %q", s.Label)
			}
			if s.Deputies != len(wantDeps[s.Label]) {
				t.Fatalf("rótulo %q: %d deputados pela API, %d no arquivo", s.Label, s.Deputies, len(wantDeps[s.Label]))
			}
			if tot := wantTotal[s.Label]; s.TotalCents != tot[0] || s.Records != tot[1] {
				t.Fatalf("rótulo %q: total da API %d/%d, arquivo %d/%d", s.Label, s.TotalCents, s.Records, tot[0], tot[1])
			}
			if s.Key == nil {
				if s.Verified {
					t.Fatalf("rótulo %q: sem chave mas verified", s.Label)
				}
				keyless++
				keylessCells += len(w)
				continue
			}
			dp := "/v1/suppliers/" + *s.Key
			dr := get(dp, "suppliers/"+*s.Key+".json")
			detailReqs++
			conforms("/v1/suppliers/{key}", dp, dr)
			var det struct {
				Label string `json:"label"`
				Cells []struct {
					DeputyID int    `json:"deputyId"`
					Month    int    `json:"month"`
					Category string `json:"category"`
					Cents    int64  `json:"cents"`
					Records  int64  `json:"records"`
				} `json:"cells"`
			}
			if err := json.Unmarshal(dr.body, &det); err != nil {
				t.Fatal(err)
			}
			if det.Label != s.Label || len(det.Cells) != len(w) {
				t.Fatalf("fornecedor %q: %d células pela API, %d no arquivo", s.Label, len(det.Cells), len(w))
			}
			for _, c := range det.Cells {
				if got := w[cellKey{c.DeputyID, c.Month, c.Category, s.Label}]; got != [2]int64{c.Cents, c.Records} {
					t.Fatalf("fornecedor %q: célula %d/%d/%s difere do arquivo", s.Label, c.DeputyID, c.Month, c.Category)
				}
			}
			keyedCells += len(det.Cells)
		}
		if pg.NextCursor == nil {
			break
		}
		cursor = *pg.NextCursor
	}
	if seenLabels != len(f.Suppliers) || keyedCells+keylessCells != fileCells {
		t.Fatalf("fornecedores: %d rótulos (esperado %d), %d+%d células (esperado %d)", seenLabels, len(f.Suppliers), keyedCells, keylessCells, fileCells)
	}

	catResp := get("/v1/categories", "categories.json")
	conforms("/v1/categories", "/v1/categories", catResp)
	var cb struct {
		TotalCents int64 `json:"totalCents"`
		Categories []struct {
			Category string `json:"category"`
			Cents    int64  `json:"cents"`
			Records  int    `json:"records"`
		} `json:"categories"`
	}
	if err := json.Unmarshal(catResp.body, &cb); err != nil {
		t.Fatal(err)
	}
	wantCat := map[string][2]int64{}
	for _, p := range summary.People {
		for _, c := range p.Categories {
			w := wantCat[c.Category]
			wantCat[c.Category] = [2]int64{w[0] + c.Cents, w[1] + int64(c.Records)}
		}
	}
	var catSum int64
	if len(cb.Categories) != len(wantCat) {
		t.Fatalf("categorias: %d, summary.json tem %d", len(cb.Categories), len(wantCat))
	}
	for _, c := range cb.Categories {
		if wantCat[c.Category] != [2]int64{c.Cents, int64(c.Records)} {
			t.Fatalf("categoria %q difere do summary.json", c.Category)
		}
		catSum += c.Cents
	}
	if catSum != summary.TotalCents || cb.TotalCents != summary.TotalCents {
		t.Fatalf("categorias somam %d, totalCents %d, summary %d", catSum, cb.TotalCents, summary.TotalCents)
	}
	t.Logf("fornecedores: %d rótulos (%d sem chave), %d células do fornecedores.json conferidas (%d por detalhe em %d requisições, %d sem chave por total), %d categorias somando %d centavos, em %s",
		seenLabels, keyless, fileCells, keyedCells, detailReqs, keylessCells, len(cb.Categories), catSum, time.Since(supStart).Round(time.Millisecond))
	t.Logf("publicação %s: %d deputados com dados, %d sem dados (listas vazias), %d registros iguais ao despesas.json, %d meses retidos com cents null, %d registros avulsos, %d requisições em %s",
		pub, withData, empty, records, heldMonths, singles, requests, time.Since(start).Round(time.Millisecond))
}
