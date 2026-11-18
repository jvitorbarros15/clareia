package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

func internal(err error) *apiError {
	log.Printf("erro de banco: %v", err)
	return &apiError{http.StatusInternalServerError, "internal", "erro ao consultar o banco"}
}

func (s *Server) healthz(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	return map[string]string{"status": "ok", "publication": pub}, nil
}

type metaBody struct {
	Publication     string            `json:"publication"`
	ExpensesVersion string            `json:"expensesVersion"`
	DomainVersions  json.RawMessage   `json:"domainVersions"`
	PublishedAt     *time.Time        `json:"publishedAt"`
	TotalCents      int64             `json:"totalCents"`
	Records         int               `json:"records"`
	MinMonths       int               `json:"minMonths"`
	Ceiling         json.RawMessage   `json:"ceiling"`
	Limitations     json.RawMessage   `json:"limitations"`
	Links           map[string]string `json:"links"`
}

func (s *Server) meta(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	b := metaBody{Publication: pub, Links: map[string]string{"methodology": "/metodologia", "corrections": "/correcoes", "openData": "/dados-abertos"}}
	err := tx.QueryRow(ctx, `SELECT expenses_version, domain_versions, published_at, total_cents, records, min_months, ceiling, limitations FROM api.publication`).
		Scan(&b.ExpensesVersion, &b.DomainVersions, &b.PublishedAt, &b.TotalCents, &b.Records, &b.MinMonths, &b.Ceiling, &b.Limitations)
	if err != nil {
		return nil, internal(err)
	}
	return b, nil
}

type deputyBody struct {
	ID                 int     `json:"id"`
	Name               string  `json:"name"`
	UF                 *string `json:"uf"`
	UFNote             *string `json:"ufNote"`
	Party              *string `json:"party"`
	PartyNote          *string `json:"partyNote"`
	PartyInReview      bool    `json:"partyInReview"`
	LastConfirmedParty *string `json:"lastConfirmedParty"`
	CurrentParty       *string `json:"currentParty"`
	PhotoURL           *string `json:"photoUrl"`
	SourceURL          *string `json:"sourceUrl"`
	Comparable         bool    `json:"comparable"`
	ExercisedMonths    int     `json:"exercisedMonths"`
	NoExercise         bool    `json:"noExercise"`
	HeldMonths         []int32 `json:"heldMonths"`
	TotalCents         int64   `json:"totalCents"`
	Records            int     `json:"records"`
	WithoutData        bool    `json:"withoutData"`
}

const deputyCols = `id, name, uf, uf_note, party, party_note, party_in_review, last_confirmed_party, current_party, photo_url, source_url, comparable, exercised_months, no_exercise, held_months, cents, records, without_data`

func (d *deputyBody) scan(row pgx.Row) error {
	return row.Scan(&d.ID, &d.Name, &d.UF, &d.UFNote, &d.Party, &d.PartyNote, &d.PartyInReview, &d.LastConfirmedParty, &d.CurrentParty, &d.PhotoURL, &d.SourceURL, &d.Comparable, &d.ExercisedMonths, &d.NoExercise, &d.HeldMonths, &d.TotalCents, &d.Records, &d.WithoutData)
}

func (s *Server) deputies(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	q := r.URL.Query()
	uf, hasUF, aerr := opt(q, "uf")
	if aerr != nil {
		return nil, aerr
	}
	if hasUF && !ufPattern.MatchString(uf) {
		return nil, errBadRequest("uf deve ter 2 letras")
	}
	party, hasParty, aerr := opt(q, "party")
	if aerr != nil {
		return nil, aerr
	}
	rows, err := tx.Query(ctx, `SELECT `+deputyCols+` FROM api.deputies
		WHERE (NOT $1::boolean OR upper(uf) = upper($2::text)) AND (NOT $3::boolean OR upper(party) = upper($4::text)) ORDER BY id`, hasUF, uf, hasParty, party)
	if err != nil {
		return nil, internal(err)
	}
	defer rows.Close()
	list := []deputyBody{}
	for rows.Next() {
		var d deputyBody
		if err := d.scan(rows); err != nil {
			return nil, internal(err)
		}
		list = append(list, d)
	}
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	return map[string]any{"publication": pub, "deputies": list}, nil
}

type monthBody struct {
	Month       int16     `json:"month"`
	Held        bool      `json:"held"`
	Cents       *int64    `json:"cents"`
	Reasons     *[]string `json:"reasons,omitempty"`
	Records     int       `json:"records"`
	Exercise    *string   `json:"exercise"`
	Party       *string   `json:"party"`
	PartyStatus string    `json:"partyStatus"`
	PartyValues []string  `json:"partyValues"`
	UF          *string   `json:"uf"`
	UFStatus    string    `json:"ufStatus"`
}

type categoryBody struct {
	Category string `json:"category"`
	Cents    int64  `json:"cents"`
	Records  int    `json:"records"`
}

func (s *Server) deputy(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	id, aerr := deputyID(r)
	if aerr != nil {
		return nil, aerr
	}
	var d deputyBody
	err := d.scan(tx.QueryRow(ctx, `SELECT `+deputyCols+` FROM api.deputies WHERE id = $1`, id))
	if err == pgx.ErrNoRows {
		return nil, errNotFound("deputado não encontrado")
	}
	if err != nil {
		return nil, internal(err)
	}
	months := []monthBody{}
	rows, err := tx.Query(ctx, `SELECT month, cents, records, exercise, party, party_status, party_values, uf, uf_status, held, held_reasons FROM api.deputy_months WHERE deputy_id = $1 ORDER BY month`, id)
	if err != nil {
		return nil, internal(err)
	}
	for rows.Next() {
		var m monthBody
		var reasons []string
		if err := rows.Scan(&m.Month, &m.Cents, &m.Records, &m.Exercise, &m.Party, &m.PartyStatus, &m.PartyValues, &m.UF, &m.UFStatus, &m.Held, &reasons); err != nil {
			rows.Close()
			return nil, internal(err)
		}
		if m.Held {
			if reasons == nil {
				reasons = []string{}
			}
			m.Reasons = &reasons
		}
		months = append(months, m)
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	cats := []categoryBody{}
	rows, err = tx.Query(ctx, `SELECT category, cents, records FROM api.deputy_categories WHERE deputy_id = $1 ORDER BY category`, id)
	if err != nil {
		return nil, internal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var c categoryBody
		if err := rows.Scan(&c.Category, &c.Cents, &c.Records); err != nil {
			return nil, internal(err)
		}
		cats = append(cats, c)
	}
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	return struct {
		Publication string `json:"publication"`
		deputyBody
		Months     []monthBody    `json:"months"`
		Categories []categoryBody `json:"categories"`
	}{pub, d, months, cats}, nil
}

func (s *Server) expenses(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	id, aerr := deputyID(r)
	if aerr != nil {
		return nil, aerr
	}
	q := r.URL.Query()
	month := 0
	if v, ok, aerr := opt(q, "month"); aerr != nil {
		return nil, aerr
	} else if ok {
		m, err := strconv.Atoi(v)
		if err != nil || m < 1 || m > 12 {
			return nil, errBadRequest("month deve ser de 1 a 12")
		}
		month = m
	}
	category, hasCat, aerr := opt(q, "category")
	if aerr != nil {
		return nil, aerr
	}
	limit := defaultLimit
	if v, ok, aerr := opt(q, "limit"); aerr != nil {
		return nil, aerr
	} else if ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxLimit {
			return nil, errBadRequest("limit deve ser de 1 a " + strconv.Itoa(maxLimit))
		}
		limit = n
	}
	after := -1
	if v, ok, aerr := opt(q, "cursor"); aerr != nil {
		return nil, aerr
	} else if ok {
		cp, seq, err := decodeCursor(v)
		if err != nil {
			return nil, errBadRequest(err.Error())
		}
		if cp != pub {
			return nil, &apiError{http.StatusConflict, "stale_cursor", "o cursor é da publicação " + cp + " e a ativa é " + pub + ": recomece a listagem sem cursor"}
		}
		after = seq
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM api.deputies WHERE id = $1)`, id).Scan(&exists); err != nil {
		return nil, internal(err)
	}
	if !exists {
		return nil, errNotFound("deputado não encontrado")
	}
	rows, err := tx.Query(ctx, `SELECT seq, record FROM api.expenses
		WHERE deputy_id = $1 AND seq > $2 AND ($3::int = 0 OR month = $3::int) AND (NOT $4::boolean OR category = $5::text)
		ORDER BY seq LIMIT $6`, id, after, month, hasCat, category, limit+1)
	if err != nil {
		return nil, internal(err)
	}
	defer rows.Close()
	list := []json.RawMessage{}
	lastSeq := 0
	var next *string
	for rows.Next() {
		var seq int
		var rec json.RawMessage
		if err := rows.Scan(&seq, &rec); err != nil {
			return nil, internal(err)
		}
		if len(list) == limit {
			c := encodeCursor(pub, lastSeq)
			next = &c
			break
		}
		list = append(list, rec)
		lastSeq = seq
	}
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	return map[string]any{"publication": pub, "deputyId": id, "expenses": list, "nextCursor": next}, nil
}

func (s *Server) expense(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	pid := r.PathValue("public_id")
	if !publicID.MatchString(pid) {
		return nil, errBadRequest("id de registro inválido (64 hex)")
	}
	var rec json.RawMessage
	err := tx.QueryRow(ctx, `SELECT record FROM api.expenses WHERE public_id = $1`, pid).Scan(&rec)
	if err == pgx.ErrNoRows {
		return nil, errNotFound("registro não encontrado")
	}
	if err != nil {
		return nil, internal(err)
	}
	return map[string]any{"publication": pub, "expense": rec}, nil
}
