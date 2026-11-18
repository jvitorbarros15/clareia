package server_test

import (
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type spec struct {
	Paths      map[string]map[string]any `yaml:"paths"`
	Components struct {
		Schemas map[string]map[string]any `yaml:"schemas"`
	} `yaml:"components"`
}

func loadSpec(t *testing.T) *spec {
	t.Helper()
	b, err := os.ReadFile("../../openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var s spec
	if err := yaml.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	return &s
}

func (s *spec) resolve(sch map[string]any) map[string]any {
	if ref, ok := sch["$ref"].(string); ok {
		return s.Components.Schemas[strings.TrimPrefix(ref, "#/components/schemas/")]
	}
	return sch
}

func typesOf(sch map[string]any) []string {
	switch v := sch["type"].(type) {
	case string:
		return []string{v}
	case []any:
		var out []string
		for _, x := range v {
			out = append(out, x.(string))
		}
		return out
	}
	return nil
}

func jsonType(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64:
		if x == float64(int64(x)) {
			return "integer"
		}
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	}
	return "object"
}

// check walks a decoded response against its schema: types, required keys, and no key the spec does not know.
func (s *spec) check(path string, v any, sch map[string]any) []string {
	sch = s.resolve(sch)
	var errs []string
	if ts := typesOf(sch); len(ts) > 0 {
		got, ok := jsonType(v), false
		for _, tp := range ts {
			if tp == got || (tp == "number" && got == "integer") {
				ok = true
			}
		}
		if !ok {
			return []string{fmt.Sprintf("%s: tipo %s, o spec diz %v", path, got, ts)}
		}
	}
	if enum, ok := sch["enum"].([]any); ok {
		found := false
		for _, en := range enum {
			if en == v {
				found = true
			}
		}
		if !found {
			errs = append(errs, fmt.Sprintf("%s: valor %v fora do enum %v", path, v, enum))
		}
	}
	switch x := v.(type) {
	case map[string]any:
		props, _ := sch["properties"].(map[string]any)
		if props == nil {
			return errs
		}
		if req, ok := sch["required"].([]any); ok {
			for _, r := range req {
				if _, has := x[r.(string)]; !has {
					errs = append(errs, fmt.Sprintf("%s: falta o campo obrigatório %s", path, r))
				}
			}
		}
		for k, val := range x {
			ps, known := props[k].(map[string]any)
			if !known {
				if sch["additionalProperties"] != true {
					errs = append(errs, fmt.Sprintf("%s: campo %s não está no spec", path, k))
				}
				continue
			}
			errs = append(errs, s.check(path+"."+k, val, ps)...)
		}
	case []any:
		if items, ok := sch["items"].(map[string]any); ok {
			for i, it := range x {
				errs = append(errs, s.check(fmt.Sprintf("%s[%d]", path, i), it, items)...)
			}
		}
	}
	return errs
}

func (s *spec) response(path, method, status string) map[string]any {
	op, _ := s.Paths[path][method].(map[string]any)
	resps, _ := op["responses"].(map[string]any)
	r, _ := resps[status].(map[string]any)
	if _, ok := r["$ref"]; ok {
		return map[string]any{"$ref": "#/components/schemas/Error"}
	}
	content, _ := r["content"].(map[string]any)
	js, _ := content["application/json"].(map[string]any)
	sch, _ := js["schema"].(map[string]any)
	return sch
}

func TestOpenAPIMatchesServer(t *testing.T) {
	s := loadSpec(t)
	e, _ := loaded(t)
	rec := fixtureRecords(t, dep180)[3]["id"].(string)

	// Every route the server has, with a request for each documented status. The spec must have exactly these paths.
	calls := []struct {
		spec   string
		url    string
		status string
	}{
		{"/healthz", "/healthz", "200"},
		{"/v1/meta", "/v1/meta", "200"},
		{"/v1/deputies", "/v1/deputies", "200"},
		{"/v1/deputies", "/v1/deputies?uf=x", "400"},
		{"/v1/deputies/{id}", "/v1/deputies/" + dep180, "200"},
		{"/v1/deputies/{id}", "/v1/deputies/" + dep493, "200"},
		{"/v1/deputies/{id}", "/v1/deputies/" + depNone, "200"},
		{"/v1/deputies/{id}", "/v1/deputies/abc", "400"},
		{"/v1/deputies/{id}", "/v1/deputies/999999999", "404"},
		{"/v1/deputies/{id}/expenses", "/v1/deputies/" + dep493 + "/expenses?limit=500", "200"},
		{"/v1/deputies/{id}/expenses", "/v1/deputies/" + depNone + "/expenses", "200"},
		{"/v1/deputies/{id}/expenses", "/v1/deputies/" + dep493 + "/expenses?limit=501", "400"},
		{"/v1/deputies/{id}/expenses", "/v1/deputies/999999999/expenses", "404"},
		{"/v1/expenses/{public_id}", "/v1/expenses/" + rec, "200"},
		{"/v1/expenses/{public_id}", "/v1/expenses/" + strings.Repeat("a", 64), "404"},
		{"/v1/expenses/{public_id}", "/v1/expenses/x", "400"},
		{"/v1/suppliers", "/v1/suppliers?limit=50", "200"},
		{"/v1/suppliers", "/v1/suppliers?q=ab", "400"},
		{"/v1/suppliers", "/v1/suppliers?cursor=" + testCursor("aaaaaaaaaaaa", "x"), "409"},
		{"/v1/suppliers/{key}", "/v1/suppliers/" + strings.Repeat("0", 64), "404"},
		{"/v1/suppliers/{key}", "/v1/suppliers/x", "400"},
		{"/v1/categories", "/v1/categories", "200"},
	}
	seen := map[string]bool{}
	for _, c := range calls {
		seen[c.spec] = true
		r := e.get(t, c.url)
		if fmt.Sprint(r.status) != c.status {
			t.Errorf("%s: status %d, esperado %s", c.url, r.status, c.status)
			continue
		}
		sch := s.response(c.spec, "get", c.status)
		if sch == nil {
			t.Errorf("%s: o spec não descreve a resposta %s", c.spec, c.status)
			continue
		}
		var body any = r.json(t)
		for _, msg := range s.check(c.url, body, sch) {
			t.Error(msg)
		}
	}
	var specPaths, tested []string
	for p := range s.Paths {
		specPaths = append(specPaths, p)
	}
	for p := range seen {
		tested = append(tested, p)
	}
	sort.Strings(specPaths)
	sort.Strings(tested)
	if strings.Join(specPaths, " ") != strings.Join(tested, " ") {
		t.Errorf("rotas do spec %v diferem das testadas %v", specPaths, tested)
	}
	for p, ops := range s.Paths {
		for m := range ops {
			if m != "get" {
				t.Errorf("%s: o spec documenta %s, a API é só GET", p, m)
			}
		}
	}

	// The 409 is only reachable with a stale cursor (tested elsewhere); it must be documented.
	for _, st := range []string{"409"} {
		if s.response("/v1/deputies/{id}/expenses", "get", st) == nil {
			t.Errorf("expenses sem resposta %s no spec", st)
		}
	}
	if r := e.do(t, http.MethodPost, "/v1/meta"); r.status != 405 {
		t.Errorf("POST: %d", r.status)
	}
	if !strings.Contains(strings.ToLower(readSpecText(t)), "duplicateflag") {
		t.Error("o spec precisa documentar duplicateFlag")
	}
}

func readSpecText(t *testing.T) string {
	b, err := os.ReadFile("../../openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
