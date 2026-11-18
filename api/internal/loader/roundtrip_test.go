package loader

import "testing"

func TestSameJSON(t *testing.T) {
	same := [][2]string{
		{`{"a":1,"b":"x"}`, `{"b":"x", "a":1}`},
		{`{"c":13100}`, `{"c":13100}`},
	}
	for _, p := range same {
		if !sameJSON([]byte(p[0]), []byte(p[1])) {
			t.Errorf("%s e %s deviam ser iguais", p[0], p[1])
		}
	}
	diff := [][2]string{
		{`{"a":1}`, `{"a":2}`},
		{`{"a":"Fornecedor"}`, `{"a":"Fornecedór"}`},
		{`{"a":1}`, `{"a":1,"b":null}`},
		{`{"a":1}`, `{"a":"1"}`},
	}
	for _, p := range diff {
		if sameJSON([]byte(p[0]), []byte(p[1])) {
			t.Errorf("%s e %s deviam ser diferentes", p[0], p[1])
		}
	}
}
