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

		prof := get("/v1/deputies/"+id, "deputies/"+id+"/profile.json").json(t)
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
	t.Logf("publicação %s: %d deputados com dados, %d sem dados (listas vazias), %d registros iguais ao despesas.json, %d meses retidos com cents null, %d registros avulsos, %d requisições em %s",
		pub, withData, empty, records, heldMonths, singles, requests, time.Since(start).Round(time.Millisecond))
}
