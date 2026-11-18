package server

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// norm makes q match without case or accents. It is applied in SQL to both sides so they always agree.
const norm = `translate(lower(%s), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')`

var supplierKey = regexp.MustCompile(`^[0-9a-f]{64}$`)

type supplierRow struct {
	Label      string  `json:"label"`
	Key        *string `json:"key"`
	Verified   bool    `json:"verified"`
	TotalCents int64   `json:"totalCents"`
	Records    int64   `json:"records"`
	Deputies   int     `json:"deputies"`
}

func encodeLabelCursor(pub, label string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(pub + ":" + label))
}

func decodeLabelCursor(c string) (pub, label string, err error) {
	b, err := base64.RawURLEncoding.DecodeString(c)
	bad := errors.New("cursor inválido")
	if err != nil || !utf8.Valid(b) {
		return "", "", bad
	}
	p, l, ok := strings.Cut(string(b), ":")
	if !ok || !folderPattern.MatchString(p) || strings.ContainsRune(l, 0) {
		return "", "", bad
	}
	return p, l, nil
}

func limitParam(q map[string][]string) (int, *apiError) {
	v, ok, aerr := opt(q, "limit")
	if aerr != nil || !ok {
		return defaultLimit, aerr
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > maxLimit {
		return 0, errBadRequest("limit deve ser de 1 a " + strconv.Itoa(maxLimit))
	}
	return n, nil
}

func (s *Server) suppliers(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	q := r.URL.Query()
	term, hasQ, aerr := opt(q, "q")
	if aerr != nil {
		return nil, aerr
	}
	if n := utf8.RuneCountInString(term); hasQ && (n < 3 || n > 100) {
		return nil, errBadRequest("q deve ter de 3 a 100 caracteres")
	}
	limit, aerr := limitParam(q)
	if aerr != nil {
		return nil, aerr
	}
	after, hasAfter := "", false
	if v, ok, aerr := opt(q, "cursor"); aerr != nil {
		return nil, aerr
	} else if ok {
		cp, label, err := decodeLabelCursor(v)
		if err != nil {
			return nil, errBadRequest(err.Error())
		}
		if cp != pub {
			return nil, &apiError{http.StatusConflict, "stale_cursor", "o cursor é da publicação " + cp + " e a ativa é " + pub + ": recomece a listagem sem cursor"}
		}
		after, hasAfter = label, true
	}
	rows, err := tx.Query(ctx, `
		WITH s AS (
		  SELECT label, supplier_key, sum(cents)::bigint AS cents, sum(records)::bigint AS records, count(DISTINCT deputy_id)::int AS deputies
		  FROM api.supplier_cells GROUP BY label, supplier_key)
		SELECT label, supplier_key, cents, records, deputies FROM s
		WHERE (NOT $1::boolean OR strpos(`+nf("label")+`, `+nf("$2::text")+`) > 0)
		  AND (NOT $3::boolean OR label COLLATE "C" > $4::text COLLATE "C")
		ORDER BY label COLLATE "C" LIMIT $5`, hasQ, term, hasAfter, after, limit+1)
	if err != nil {
		return nil, internal(err)
	}
	defer rows.Close()
	list := []supplierRow{}
	var next *string
	for rows.Next() {
		var x supplierRow
		if err := rows.Scan(&x.Label, &x.Key, &x.TotalCents, &x.Records, &x.Deputies); err != nil {
			return nil, internal(err)
		}
		if len(list) == limit {
			c := encodeLabelCursor(pub, list[len(list)-1].Label)
			next = &c
			break
		}
		x.Verified = x.Key != nil
		list = append(list, x)
	}
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	return map[string]any{"publication": pub, "suppliers": list, "nextCursor": next}, nil
}

type cellBody struct {
	DeputyID int    `json:"deputyId"`
	Month    int16  `json:"month"`
	Category string `json:"category"`
	Cents    int64  `json:"cents"`
	Records  int    `json:"records"`
}

func (s *Server) supplier(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	key := r.PathValue("key")
	if !supplierKey.MatchString(key) {
		return nil, errBadRequest("chave de fornecedor inválida (64 hex)")
	}
	rows, err := tx.Query(ctx, `SELECT deputy_id, month, category, label, cents, records FROM api.supplier_cells
		WHERE supplier_key = $1 ORDER BY deputy_id, month, category`, key)
	if err != nil {
		return nil, internal(err)
	}
	defer rows.Close()
	cells := []cellBody{}
	deputies := map[int]bool{}
	var label string
	var total, records int64
	for rows.Next() {
		var c cellBody
		if err := rows.Scan(&c.DeputyID, &c.Month, &c.Category, &label, &c.Cents, &c.Records); err != nil {
			return nil, internal(err)
		}
		total += c.Cents
		records += int64(c.Records)
		deputies[c.DeputyID] = true
		cells = append(cells, c)
	}
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	if len(cells) == 0 {
		return nil, errNotFound("fornecedor não encontrado")
	}
	return map[string]any{"publication": pub, "key": key, "label": label, "verified": true, "totalCents": total, "records": records, "deputies": len(deputies), "cells": cells}, nil
}

func (s *Server) categories(ctx context.Context, tx pgx.Tx, r *http.Request, pub string) (any, *apiError) {
	var total int64
	var records int
	if err := tx.QueryRow(ctx, `SELECT total_cents, records FROM api.publication`).Scan(&total, &records); err != nil {
		return nil, internal(err)
	}
	rows, err := tx.Query(ctx, `SELECT category, sum(cents)::bigint, sum(records)::bigint FROM api.deputy_categories GROUP BY category ORDER BY 2 DESC, category COLLATE "C"`)
	if err != nil {
		return nil, internal(err)
	}
	defer rows.Close()
	cats := []categoryBody{}
	var sumCents, sumRecords int64
	for rows.Next() {
		var c categoryBody
		var n int64
		if err := rows.Scan(&c.Category, &c.Cents, &n); err != nil {
			return nil, internal(err)
		}
		c.Records = int(n)
		sumCents += c.Cents
		sumRecords += n
		cats = append(cats, c)
	}
	if rows.Err() != nil {
		return nil, internal(rows.Err())
	}
	if sumCents != total || sumRecords != int64(records) {
		return nil, internal(errors.New("categorias não fecham com o total da publicação"))
	}
	return map[string]any{"publication": pub, "totalCents": total, "records": records, "categories": cats}, nil
}

func nf(expr string) string { return strings.Replace(norm, "%s", expr, 1) }
