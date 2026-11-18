\set ON_ERROR_STOP on
\t on
select deputy_id as wid, n - 101 as wafter from (select deputy_id, count(*) n from api.expenses group by 1 order by 2 desc, 1 limit 1) w \gset
select public_id as pid from api.expenses order by public_id limit 1 offset 1000 \gset
select supplier_key as key from api.supplier_cells where supplier_key is not null group by 1 order by sum(records) desc, 1 limit 1 \gset
select w as term from (select distinct (regexp_match(label, '[A-Za-z]{4,}'))[1] w from api.supplier_cells) t where w is not null order by md5(w) limit 1 \gset
select label as lbl from (select distinct label from api.supplier_cells) t order by md5(label) limit 1 \gset
\t off
\echo === publication (every request)
EXPLAIN (ANALYZE, BUFFERS) SELECT folder_id FROM api.publication;
\echo === profile: deputy row
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM api.deputies WHERE id = :wid;
\echo === profile: months
EXPLAIN (ANALYZE, BUFFERS) SELECT month, cents, records, exercise, party, party_status, party_values, uf, uf_status, held, held_reasons FROM api.deputy_months WHERE deputy_id = :wid ORDER BY month;
\echo === profile: categories
EXPLAIN (ANALYZE, BUFFERS) SELECT category, cents, records FROM api.deputy_categories WHERE deputy_id = :wid ORDER BY category;
\echo === expenses: worst case, last page (deputy with most records)
EXPLAIN (ANALYZE, BUFFERS) SELECT seq, record FROM api.expenses WHERE deputy_id = :wid AND seq > :wafter AND (0 = 0 OR month = 0) AND (NOT false OR category = 'x') ORDER BY seq LIMIT 101;
\echo === expenses: first page
EXPLAIN (ANALYZE, BUFFERS) SELECT seq, record FROM api.expenses WHERE deputy_id = :wid AND seq > -1 ORDER BY seq LIMIT 101;
\echo === expenses: deputy exists check
EXPLAIN (ANALYZE, BUFFERS) SELECT EXISTS (SELECT 1 FROM api.deputies WHERE id = :wid);
\echo === expense by public_id
EXPLAIN (ANALYZE, BUFFERS) SELECT record FROM api.expenses WHERE public_id = :'pid';
\echo === supplier detail: most records
EXPLAIN (ANALYZE, BUFFERS) SELECT deputy_id, month, category, label, cents, records FROM api.supplier_cells WHERE supplier_key = :'key' ORDER BY deputy_id, month, category;
\echo === categories
EXPLAIN (ANALYZE, BUFFERS) SELECT category, sum(cents)::bigint, sum(records)::bigint FROM api.deputy_categories GROUP BY category ORDER BY 2 DESC, category COLLATE "C";
\echo === meta
EXPLAIN (ANALYZE, BUFFERS) SELECT expenses_version, domain_versions, published_at, total_cents, records, min_months, ceiling, limitations FROM api.publication;
\echo === NEW suppliers table: first page, limit 100 (what the server runs now)
EXPLAIN (ANALYZE, BUFFERS)
SELECT label, supplier_key, total_cents, records, deputies FROM api.suppliers
WHERE (NOT false OR strpos(label, 'x') > 0) AND (NOT false OR label COLLATE "C" > 'x' COLLATE "C")
ORDER BY label COLLATE "C" LIMIT 101;
\echo === NEW suppliers table: search q (what the server runs now)
EXPLAIN (ANALYZE, BUFFERS)
SELECT label, supplier_key, total_cents, records, deputies FROM api.suppliers
WHERE (NOT true OR strpos(label_norm, translate(lower(:'term'::text), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')) > 0)
  AND (NOT false OR label COLLATE "C" > 'x' COLLATE "C")
ORDER BY label COLLATE "C" LIMIT 51;
\echo === NEW suppliers table: cursor page (what the server runs now)
EXPLAIN (ANALYZE, BUFFERS)
SELECT label, supplier_key, total_cents, records, deputies FROM api.suppliers
WHERE (NOT false OR strpos(label, 'x') > 0) AND (NOT true OR label COLLATE "C" > :'lbl'::text COLLATE "C")
ORDER BY label COLLATE "C" LIMIT 101;
