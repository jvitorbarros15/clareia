package loader

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Each query returns the number of offending rows and must return 0.
const (
	sqlPersonTotals = `
SELECT count(*) FROM deputies d
LEFT JOIN (SELECT deputy_id, sum(cents) AS cents, count(*) AS n FROM expenses GROUP BY 1) e ON e.deputy_id = d.id
WHERE d.cents <> coalesce(e.cents, 0) OR d.records <> coalesce(e.n, 0)`

	sqlMonthTotals = `
SELECT count(*) FROM deputy_months m
FULL JOIN (SELECT deputy_id, month, sum(cents) AS cents, count(*) AS n FROM expenses GROUP BY 1, 2) e ON e.deputy_id = m.deputy_id AND e.month = m.month
WHERE m.deputy_id IS NULL
   OR (m.held AND (m.cents IS NOT NULL OR e.n IS NOT NULL))
   OR (NOT m.held AND (m.cents IS DISTINCT FROM coalesce(e.cents, 0) OR m.records <> coalesce(e.n, 0)))`

	sqlCategoryTotals = `
SELECT count(*) FROM deputy_categories c
FULL JOIN (SELECT deputy_id, category, sum(cents) AS cents, count(*) AS n FROM expenses GROUP BY 1, 2) e ON e.deputy_id = c.deputy_id AND e.category = c.category
WHERE c.deputy_id IS NULL OR e.deputy_id IS NULL OR c.cents <> e.cents OR c.records <> e.n`

	sqlSupplierCells = `
SELECT count(*) FROM supplier_cells c
FULL JOIN (SELECT deputy_id, month, category, coalesce(record->>'supplierLabel', record->>'supplier') AS label, sum(cents) AS cents, count(*) AS n
           FROM expenses GROUP BY 1, 2, 3, 4) e
  ON e.deputy_id = c.deputy_id AND e.month = c.month AND e.category = c.category AND e.label = c.label
WHERE c.deputy_id IS NULL OR e.deputy_id IS NULL OR c.cents <> e.cents OR c.records <> e.n`

	sqlLabelKeys = `
SELECT count(*) FROM (
  SELECT label FROM (SELECT coalesce(record->>'supplierLabel', record->>'supplier') AS label, supplier_key, verified FROM expenses GROUP BY 1, 2, 3) g
  GROUP BY label HAVING count(*) > 1) x`

	sqlHeldBad = `
SELECT count(*) FROM deputy_months m
WHERE (m.held AND (m.cents IS NOT NULL OR EXISTS (SELECT 1 FROM expenses e WHERE e.deputy_id = m.deputy_id AND e.month = m.month)))
   OR (NOT m.held AND m.cents IS NULL)`

	sqlWithoutDataBad = `
SELECT count(*) FROM deputies d
WHERE d.without_data <> NOT EXISTS (SELECT 1 FROM expenses e WHERE e.deputy_id = d.id)`

	sqlHeldMonthsBad = `
SELECT count(*) FROM deputies d
WHERE d.held_months <> coalesce((SELECT array_agg(month::integer ORDER BY month) FROM deputy_months m WHERE m.deputy_id = d.id AND m.held), '{}')`
)

type checker struct {
	ctx     context.Context
	tx      pgx.Tx
	results []Result
}

func (c *checker) add(name string, ok bool, format string, a ...any) {
	c.results = append(c.results, Result{Name: name, OK: ok, Detail: fmt.Sprintf(format, a...)})
}

func (c *checker) count(sql string, args ...any) int64 {
	var n int64
	if err := c.tx.QueryRow(c.ctx, sql, args...).Scan(&n); err != nil {
		c.add("consulta", false, "%v", err)
		return -1
	}
	return n
}

func (c *checker) zero(name, sql, what string) {
	n := c.count(sql)
	c.add(name, n == 0, "%d %s", n, what)
}

func runChecks(ctx context.Context, tx pgx.Tx, pub *Publication) ([]Result, error) {
	c := &checker{ctx: ctx, tx: tx}
	s, v := pub.Summary, pub.Validation

	var total, rows, distinct int64
	err := tx.QueryRow(ctx, `SELECT coalesce(sum(cents), 0), count(*), count(DISTINCT public_id) FROM expenses`).Scan(&total, &rows, &distinct)
	if err != nil {
		return nil, err
	}
	c.add("total em centavos", total == s.TotalCents && v.TotalCents == s.TotalCents, "banco %d, summary %d, index %d", total, s.TotalCents, v.TotalCents)
	c.add("contagem de registros", rows == int64(s.Records) && v.RecordCount == s.Records, "banco %d, summary %d, index %d", rows, s.Records, v.RecordCount)
	c.add("public_id distintos", distinct == rows, "%d distintos de %d registros", distinct, rows)

	ids := map[int]bool{}
	var personSum int64
	var personRecords int
	for _, p := range s.People {
		ids[p.ID] = true
		personSum += p.Cents
		personRecords += p.Records
	}
	indexIDs := map[int]bool{}
	for _, p := range pub.Index.People {
		indexIDs[p.ID] = true
	}
	c.add("pessoas do summary = index = escopo", len(ids) == len(s.People) && reflect.DeepEqual(ids, indexIDs) && len(s.Scope.IDs) == len(ids), "summary %d, index %d, escopo %d", len(ids), len(indexIDs), len(s.Scope.IDs))
	c.add("soma das pessoas = total", personSum == s.TotalCents && personRecords == s.Records, "soma %d centavos, %d registros", personSum, personRecords)
	c.zero("total por pessoa", sqlPersonTotals, "pessoas divergentes do summary")
	c.zero("total por pessoa e mês", sqlMonthTotals, "meses divergentes do summary")
	c.zero("total por pessoa e categoria", sqlCategoryTotals, "categorias divergentes do summary")

	c.add("categorias do summary = fornecedores", slices.Equal(s.Categories, pub.Suppliers.Categories) && s.PublicationID == pub.Suppliers.PublicationID, "%d categorias", len(s.Categories))
	var cellCount, labels int64
	if err := tx.QueryRow(ctx, `SELECT count(*), count(DISTINCT label) FROM supplier_cells`).Scan(&cellCount, &labels); err != nil {
		return nil, err
	}
	var expectedCells int
	for _, cells := range pub.Suppliers.People {
		expectedCells += len(cells)
	}
	unique := map[string]bool{}
	for _, l := range pub.Suppliers.Suppliers {
		unique[l] = true
	}
	c.add("células de fornecedor: contagem e rótulos", cellCount == int64(expectedCells) && labels == int64(len(pub.Suppliers.Suppliers)) && len(unique) == len(pub.Suppliers.Suppliers), "%d células, %d rótulos", cellCount, labels)
	c.zero("células de fornecedor = despesas agrupadas", sqlSupplierCells, "células divergentes de fornecedores.json")
	c.zero("um rótulo = uma chave", sqlLabelKeys, "rótulos com mais de uma chave ou verificação")

	var nWithout, nWithoutRows int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM deputies WHERE without_data`).Scan(&nWithout); err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM expenses e JOIN deputies d ON d.id = e.deputy_id WHERE d.without_data`).Scan(&nWithoutRows); err != nil {
		return nil, err
	}
	c.add("withoutData sem registros", nWithout == int64(len(pub.Index.WithoutData)) && nWithoutRows == 0, "%d pessoas, %d registros", nWithout, nWithoutRows)
	c.zero("withoutData = pessoas sem registro", sqlWithoutDataBad, "pessoas com marca errada")

	c.zero("mês retido: cents nulo e zero registros", sqlHeldBad, "meses incoerentes")
	c.zero("heldMonths do summary = meses retidos", sqlHeldMonthsBad, "pessoas divergentes")
	checkHeldSet(c, pub)

	if err := roundTrip(c, pub); err != nil {
		return c.results, err
	}
	return c.results, nil
}

func checkHeldSet(c *checker, pub *Publication) {
	rows, err := c.tx.Query(c.ctx, `SELECT deputy_id, month, coalesce(held_reasons::text, 'null') FROM deputy_months WHERE held`)
	if err != nil {
		c.add("meses retidos = heldCompetences", false, "%v", err)
		return
	}
	defer rows.Close()
	got := map[[2]int][]string{}
	for rows.Next() {
		var id, month int
		var why string
		if err := rows.Scan(&id, &month, &why); err != nil {
			c.add("meses retidos = heldCompetences", false, "%v", err)
			return
		}
		var reasons []string
		_ = json.Unmarshal([]byte(why), &reasons)
		got[[2]int{id, month}] = reasons
	}
	want := map[[2]int][]string{}
	for _, h := range pub.Validation.HeldCompetences {
		want[[2]int{h.PersonID, h.Month}] = h.Reasons
	}
	ok := len(got) == len(want) && len(want) == len(pub.Validation.HeldCompetences)
	for k, w := range want {
		g, found := got[k]
		if !found || !reflect.DeepEqual(append([]string{}, g...), append([]string{}, w...)) || len(w) == 0 {
			ok = false
		}
	}
	perPerson := map[string]int{}
	for k := range got {
		perPerson[fmt.Sprint(k[0])]++
	}
	c.add("meses retidos = heldCompetences e motivos gravados", ok && reflect.DeepEqual(perPerson, pub.Validation.HeldMonths), "%d meses retidos no banco, %d em heldCompetences", len(got), len(want))
}

// roundTrip reads every deputy's records back from Postgres in seq order and compares them with despesas.json.
func roundTrip(c *checker, pub *Publication) error {
	var checked, mismatched int
	var first string
	for _, p := range pub.Summary.People {
		raws, _, ok, err := pub.readRecords(p.ID)
		if err != nil {
			return err
		}
		if !ok {
			raws = nil
		}
		rows, err := c.tx.Query(c.ctx, `SELECT record::text FROM expenses WHERE deputy_id = $1 ORDER BY seq`, p.ID)
		if err != nil {
			return err
		}
		var back []string
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				rows.Close()
				return err
			}
			back = append(back, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		bad := len(back) != len(raws)
		for i := 0; !bad && i < len(raws); i++ {
			if !sameJSON(raws[i], []byte(back[i])) {
				bad = true
			}
		}
		checked += len(raws)
		if bad {
			mismatched++
			if first == "" {
				first = fmt.Sprint(p.ID)
			}
		}
	}
	c.add("ida e volta registro a registro", mismatched == 0, "%d registros lidos de volta, %d deputados divergentes %s", checked, mismatched, strings.TrimSpace(first))
	return nil
}

func sameJSON(a, b []byte) bool {
	var x, y any
	da, db := json.NewDecoder(strings.NewReader(string(a))), json.NewDecoder(strings.NewReader(string(b)))
	da.UseNumber()
	db.UseNumber()
	if da.Decode(&x) != nil || db.Decode(&y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}
