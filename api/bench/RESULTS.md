226,510 records, one laptop, loopback, k6 and server and Postgres on the same machine

# Clareia public API: benchmark (Phase 4, after the `suppliers` table)

Everything here is a measurement of Go + pgx + JSON serialization over loopback. It does not measure disk (all data is cached in memory), network, TLS, a proxy or real users. The traffic mix is an assumption, not observed traffic: the site is not launched. Rate limiting is off.

There are two sets of measurements of the same code base. The first benchmark (`results/before-suppliers-table/`, its text in `results/before-suppliers-table/RESULTS-before.md`) found that the supplier list re-aggregated 123,504 rows on every request and capped the API at 168 req/s. The loader now builds a per-publication `suppliers` table (commit `1ba94df`) and `/v1/suppliers` reads it. The rest of this file is the rerun with that table: `results/run1` and `results/run2`.

## Status of the plan's criteria

- **The plan's criterion "a second full run within ±10% on p95" was NOT met**: it is met only by step (a). Static files (0) and the real API setup (b) missed it. Whether to waive it is João's decision; I did not change the criterion or rerun until it passed.
- **The supplier list is below the 50 ms line; the supplier search is not.** A `q` search with fewer than 51 results scans all 21,677 labels (p50 73 to 88 ms in step (b)). This is a known limitation; whether to fix it (for example by storing a normalized label column) is João's decision.
  - Note 2026-11-19: the search now uses the stored `suppliers.label_norm` column. One EXPLAIN ANALYZE of a no-match search went from 66 ms to 2.2 ms (Postgres only, not k6). The HTTP p50 of 73 to 88 ms above was not re-measured.

## Headline numbers after the `suppliers` table

Reference rate 100 req/s, 5 runs of 90 s per step per full run. p50 and p99 are the median of the 5 runs; p95 is shown as the range (min to max) of the 5 runs. Zero dropped iterations and 0.000% errors in every run at this rate; achieved 100.0 req/s each time.

| step | p50 ms (run 1 / run 2) | p95 ms, range of 5 (run 1 / run 2) | p99 ms (run 1 / run 2) | max rate with zero dropped, 20 s steps (run 1 / run 2) |
|---|---|---|---|---|
| (0) static files | 3.1 / 3.2 | 10.6 to 16.2 / 13.6 to 15.0 | 21.5 / 24.0 | at least 1,275 / at least 1,275 |
| (a) API, full-scan cost (no extra indexes) | 6.7 / 7.2 | 36.3 to 36.8 / 33.7 to 36.7 | 94.7 / 77.6 | at least 252 / at least 378 |
| (b) API, with indexes | 5.7 / 5.5 | 21.7 to 24.4 / 22.8 to 26.1 | 85.5 / 73.4 | at least 850 / at least 1,275 |

**For the real setup (b) the number to quote is "at least 850 req/s (20-second steps), zero dropped".** The two runs agree on 850; 1,275 failed in run 1 (421 dropped) and passed in run 2, so it is not a confirmed rate. The ladder is coarse (each rung is x1.5 of the last, one 20 s run per rung) and the limit after the table was not diagnosed (probably Postgres CPU; the Go server used about 1 core at 1,275 req/s). The static server failed at 1,912 in both runs.

### Reproducibility of p95 (plan criterion not met)

The five p95 values inside each 90 s block, per step, for both full runs:

| step | run 1, five values | run 2, five values | median change |
|---|---|---|---|
| (0) static files | 10.6, 11.8, 12.0, 14.3, 16.2 | 13.6, 13.8, 14.7, 14.9, 15.0 | +22% |
| (a) no extra indexes | 36.3, 36.4, 36.7, 36.7, 36.8 | 33.7, 34.0, 34.3, 35.8, 36.7 | -6.5% |
| (b) with indexes | 21.7, 21.8, 21.9, 23.9, 24.4 | 22.8, 24.7, 25.6, 26.0, 26.1 | +17% |

For static, the five values of run 1 (10.6 to 16.2) contain all five of run 2: the spread inside one run (53%) is larger than the difference between the two runs (22%). For (b) the ranges overlap (22.8 to 24.4 is common). The data support a **p95 noise floor of about ±20% at 100 req/s on this machine between blocks of 90 s; quote the range, not a point.** Only (a) is stable (36.3 to 36.8), probably because its p95 is set by the slow scans and not by idle-machine latency (next paragraph). The p50 values are stable (within 6%).

### Hypothesis, untested: the p95 at 100 req/s partly measures an idle machine

Three observations in the raw data, none of them proven to be the cause:
- In the ladder, p95 falls as the rate rises: in (b) run 1 it goes from 22 ms at 50 req/s to 10 ms at 850 req/s.
- Cheap endpoints are slower in (b) than in (a) even though (b) is the faster setup: p95 of `profile` is 10.5 ms in (a) and 19 to 25 ms in (b); `meta` 7 ms against 14 to 17 ms. In (a) Postgres burns CPU (160 to 220% mid-run) and in (b) it is nearly idle (5 to 8%).
- `profile` had a p95 of 11.6 to 15.2 ms before the table and 18 to 25 ms after it, with no change in its code.

The likely reading is that with the machine almost idle (power plan "Balanced", Postgres in the WSL2 VM) the time to wake cores dominates the tail, which would also explain why p95 does not reproduce. It was not tested (for example with the "High performance" plan or a background load). The steps also always run in the same order (static, (a), (b)), so a comparison between steps is mixed with elapsed time.

## Before and after the `suppliers` table

Ranges are min to max over the runs of both full runs. Postgres execution times are single `EXPLAIN (ANALYZE, BUFFERS)` measurements, not distributions.

| | before (aggregation on every request) | after (`suppliers` table) |
|---|---|---|
| Postgres, supplier list first page | 181 ms | 0.03 ms |
| Postgres, supplier list cursor page | 140 ms | 0.08 ms |
| Postgres, search `q` | 222 ms | 0.3 ms only in the best case (the term `ltda`: 51 results in the first 55 rows); any search with fewer than 51 results scans all 21,677 labels |
| HTTP p95 of `suppliers_list` at 100 req/s, (b) | 169 to 214 ms | 12.9 to 19.0 ms |
| HTTP p50 of `suppliers_search` at 100 req/s, (b) | 250 to 283 ms | 73 to 88 ms |
| HTTP p95 of `suppliers_search` at 100 req/s, (b) | 332 to 453 ms | 85 to 98 ms |
| Overall p95 at 100 req/s, (b) | 27.6 to 34.5 ms (3 runs per full run) | 21.7 to 26.1 ms |
| Overall p99 at 100 req/s, (b), median | 272 / 278 ms | 85 / 73 ms |
| Max rate with zero dropped, (b), 20 s steps | 168 | at least 850 |
| Max rate with zero dropped, (a), 20 s steps | 112 | at least 252 |
| Postgres CPU mid-run at 100 req/s, (b), one docker stats sample per run | about 280% of a core | 5 to 8% of a core |

The supplier **list** went from far above the 50 ms line (Fable review of phase 3, item 6) to well below it. The supplier **search** improved about 3 to 4 times in the benchmark but is still above 50 ms: the benchmark's search terms are words taken from real labels (`fixture.sql`), so each one matches at least one label, and the median search in the mix still scans the whole table (the query stops early only when it finds `limit+1` = 51 labels). Searching a supplier by name is exactly that case. Search is the slowest path now and sets the p99 (about 75 to 85 ms) with 2% of the mix. The static server still wins on raw speed (at least 1,275 req/s against at least 850 for the API, 3 ms p50 against 5.5 ms) and sends about 70 times more bytes per response (1,402 KB against 20.1 KB). At 226 thousand records Postgres is not needed for performance; the API's value is filters, cursor pagination, supplier search across deputies and small responses.

What was checked on the new table: on a fresh load the loader verifies it against `supplier_cells` and its row count against the labels of `fornecedores.json`, in the load transaction. When the table is added to an already loaded schema (the no-op path of `load.ps1`, or `--rollback` to an older publication) it is created, filled and verified against `supplier_cells` only (which was itself checked cell by cell against `fornecedores.json` at load time) in one transaction. A tampered or missing row is refused, with a hint on how to rebuild (tests added). The contract test against the real publication passes (21,677 labels, 123,504 cells equal to `fornecedores.json`, 226,510 records equal to `despesas.json`). The new server needs the loader to have run first (see `api/README.md`).

## Environment

| item | value |
|---|---|
| CPU | Intel Core i9-14900HX, 24 cores / 32 logical processors |
| RAM | 31.7 GB |
| Disk | NVMe Micron 2500 (MTFDKBA1T0QGN), SSD, 954 GB |
| OS | Windows 11 Home 10.0.26200 |
| Docker / WSL2 | Docker 29.0.1 (client and server); WSL 2.6.1.0, kernel 6.6.87.2-1. Postgres runs in the WSL2 VM, so loopback to it crosses the VM boundary |
| Power | plan "Balanced"; plugged in (battery status 2 = AC) |
| Go / Postgres / k6 | go1.27.4 windows/amd64; PostgreSQL 16.16 (Debian, container `clareia-api-pg`); k6 v2.4.0 |
| Code | commit `1ba94df` (server and loader with the `suppliers` table); the "before" runs used `58456cf` |
| Publication | `b571fe73c261` (226,510 expense records, 592 deputies, 562 with data); the `suppliers` table was added to it by the loader's no-op path |
| Not recorded | Docker/WSL CPU and memory limits for the Postgres VM (unknown), Postgres settings (appear to be image defaults), antivirus and other background load (unknown) |

Raw environment and per-run process CPU: `results/run*/env.json` and `results/run*/*/*.proc.json`. CPU numbers are server or k6 CPU time divided by wall time (1.0 = one core); the Postgres figure is one `docker stats` sample mid-run, in percent of one core.

## Method

- **Open model.** k6 `constant-arrival-rate`. A run is valid only with zero `dropped_iterations`, error rate under 0.1% and p99 under 1 s (thresholds in `mix.js`).
- **Assumed mix.** 60% deputy profile, 25% expense pages, 10% suppliers (half list or search, half detail), 5% meta. Ids come from a PRNG seeded with `20261118` and the global iteration number, so every run sends the same sequence of requests; ids are skewed (`index = floor(N * u^2)`), also an assumption.
  - Expense pages: 5% are the worst case (deputy 220554, 1,885 records, last page of 100), 25% of the rest use a random cursor. `limit=100`.
  - Suppliers: lists use `limit=100` (30% with a cursor), searches (`q`, 40% of list requests) use `limit=50`, with terms taken from real labels; details pick keys skewed to the most-used suppliers (the top one has 5,177 cells).
  - 404s: 2% of profile requests ask for a missing deputy and 5% of supplier details for an unknown key; they count as expected.
- **Step (0) static baseline.** `api/bench/static` (Go `http.FileServer`) serves the same JSON files on loopback; each request maps to the file the site would read (profile -> `summary.json` 1.7 MB, expense page -> `deputados/<id>/despesas.json`, suppliers -> `fornecedores.json` 3.2 MB, meta -> `index.json`). The 30 deputies without data have no file and return 404. It returns whole files, so it is faster per request but sends about 70 times more bytes and the client must filter and paginate. No static equivalent of `suppliers_search`.
- **Step (a) "full-scan cost on 226 thousand rows".** The API against `clareia_api_bench_noidx`, a copy of the real database (`CREATE DATABASE ... TEMPLATE`) in which every index and primary/unique constraint on `expenses`, `supplier_cells`, `deputy_months`, `deputy_categories` and `suppliers` was dropped (kept: `deputies_pkey`, `publication_pkey`), then `ANALYZE`. The real database was never altered by the benchmark; the copy is dropped at the end of `run.ps1`. This is the price of scanning, not an optimization.
- **Step (b) with indexes.** The real setup (`clareia_api`, role `clareia_api_ro`, pool of 10).
- **Per step:** 20 s warm-up at the reference rate, then 5 runs of 90 s at 100 req/s (the first benchmark used 3 runs of 45 s). Then a rate ladder: 20 s per rung from 50 req/s, each rung 1.5x the last, until the first invalid run. One run per rung.
- **304 versus 200** (`etag.js`, step b): the same URL with and without `If-None-Match` at 40 req/s for 20 s each, 3 runs. Latency only.
- **EXPLAIN (ANALYZE, BUFFERS)** of every query the server issues (`explain.sql`), second execution. Run 1's EXPLAIN used the earlier query list (the aggregation queries only); run 2's includes the new `suppliers` queries next to the old ones, labelled (the old ones are no longer in `explain.sql`).
- Reproduce: `powershell -File api/bench/run.ps1 -Name runN -StaticData <data folder of the active publication>`, then `api/bench/tables.ps1 -Name runN`. Needs the container with an active publication that has the `suppliers` table (run `load.ps1` on its folder once), `~/.clareia/api-pg.env`, k6, Go, and ports 8787 and 8788 free (the script refuses otherwise). Credentials never leave the process. About 45 minutes per run.

## Not measured

- Real network, TLS, a reverse proxy, a CDN, other clients. Loopback to Postgres crosses the WSL2 VM boundary.
- A cold cache or disk (EXPLAIN shows `shared hit` almost everywhere).
- Rate limiting (off), authentication, the publication switch under load.
- Endpoints not in the mix: `GET /v1/deputies` with filters, `month` and `category` filters, `/v1/expenses/{id}`, `/v1/categories`, `/healthz`.
- Memory, GC, pool saturation as such (pool is 10), long soak runs, other Postgres settings, other power plans.
- Search terms with no match at all (every benchmark term matches at least one label), and the cost of search per number of results.
- Any mix other than the assumed one.
- The cause of the capacity limit after the table (probably Postgres CPU; not diagnosed).
- Postgres CPU beyond one `docker stats` sample per run.
- The order of the steps is fixed (static, (a), (b)), so elapsed time is mixed into comparisons between steps.
- Day-to-day variation: two full runs back to back, which already differ by up to 22% in the median p95 on two steps.

## Suggested resume bullet (suggestion, check it before use)

> Built a read-only Go + PostgreSQL API over 226,510 public expense records and load-tested it with k6 (open model, assumed traffic mix, one laptop, loopback): p50 about 5.5 ms and p95 22 to 26 ms at 100 req/s. The test exposed a supplier list that re-aggregated 123 thousand rows on every request; a table pre-aggregated at load time cut that endpoint's p95 from about 190 ms to about 15 ms and raised the rate held with zero dropped requests from 168 to at least 850 req/s (20-second steps). A plain static-file server on the same machine held 1,275 req/s.

## Tables per run, after the `suppliers` table

Generated by `tables.ps1` from the stored k6 summaries, kept in [results/run1/tables.md](results/run1/tables.md) and [results/run2/tables.md](results/run2/tables.md): runs per step at the reference rate, p95 by endpoint, the rate ladder and 304 versus 200 latency.

## EXPLAIN (ANALYZE, BUFFERS) after the table

Run 2 (`results/run2/explain-with-indexes.txt`), with indexes: the list queries `/v1/suppliers` runs now are an `Index Scan using suppliers_pkey` with `LIMIT` (first page 0.03 ms, cursor page 0.08 ms; single measurements). A search stops early only when it finds 51 labels: the term `ltda` does (0.3 ms, the best case); any term with fewer than 51 results filters all 21,677 rows with `strpos(translate(lower(label), ...))`, which is why the HTTP p50 of `suppliers_search` is 73 to 88 ms. The old aggregation queries were removed from `explain.sql` after the table landed; they measured 148 to 191 ms in run 2 and 188 to 255 ms in run 1; their plans before the table (a `Sort` through 14.5 MB of temp files and a `GroupAggregate` over 123,504 rows) are described in `results/before-suppliers-table/RESULTS-before.md`. All other queries are unchanged: deputy, months and categories under 0.3 ms; expense page 0.04 to 0.1 ms with indexes against 22 to 25 ms without; supplier detail about 3 ms with indexes against 12 ms without.

Run 1 and run 2 EXPLAIN files are in `results/run1/` and `results/run2/`.

## Files

`run.ps1`, `tables.ps1`, `mix.js`, `etag.js`, `fixture.sql`, `explain.sql`, `static/main.go`; `results/run1`, `results/run2` (after the table); `results/before-suppliers-table/` (the first benchmark: `RESULTS-before.md`, its text as written then, plus per-run `tables.md`, `env.json` and EXPLAIN text; the raw per-probe JSON was deleted, the numbers are in the tables). The JSON files are the reduced summaries written by k6's `handleSummary` (percentiles, rates, per-endpoint latency), not the full k6 output.
