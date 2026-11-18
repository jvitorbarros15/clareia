226,510 records, one laptop, loopback, k6 and server and Postgres on the same machine

# Clareia public API: benchmark (Phase 4, after the `suppliers` table)

Everything here is a measurement of Go + pgx + JSON serialization over loopback. It does not measure disk (all data is cached in memory), network, TLS, a proxy or real users. The traffic mix is an assumption, not observed traffic: the site is not launched. Rate limiting is off.

This file has two sets of measurements of the same code base. The first benchmark (appendix at the end, files in `results/before-suppliers-table/`) found that the supplier list re-aggregated 123,504 rows on every request (140 to 230 ms) and capped the API at 168 req/s. The loader now builds a per-publication `suppliers` table (commit `1ba94df`) and `/v1/suppliers` reads it. Everything above the appendix is the rerun with that table: `results/run1` and `results/run2`.

## Headline numbers after the `suppliers` table (reference 100 req/s, median of 5 runs of 90 s, run 1 / run 2)

| step | p50 ms | p95 ms | p99 ms | p95 change, run 2 vs run 1 | max sustainable req/s |
|---|---|---|---|---|---|
| (0) static files | 3.14 / 3.23 | 12.03 / 14.69 | 21.51 / 23.98 | +22.1% (misses ±10%) | 1,275 / 1,275 |
| (a) API, full-scan cost (no extra indexes) | 6.74 / 7.16 | 36.71 / 34.31 | 94.71 / 77.56 | -6.5% (within) | 252 / 378 |
| (b) API, with indexes | 5.68 / 5.48 | 21.91 / 25.60 | 85.48 / 73.40 | +16.8% (misses ±10%) | 850 / 1,275 |

All runs at the reference rate had zero dropped iterations and 0.000% errors; achieved 100.0 req/s each time.

**Reproducibility, stated plainly: the criterion "p95 within ±10% between two full runs" is met only by step (a). It is missed by the static baseline (+22.1%) and by step (b), the real setup (+16.8%).** I made the runs longer (90 s instead of 45 s) and took the median of 5 instead of 3, as asked, and did not change the criterion. What the data shows:
- The run-to-run shift is systematic, not sampling noise: within one full run the 5 values of p95 are tight (static run 2: 13.6 to 15.0 ms; (b) run 1: 21.7 to 24.4 ms; (b) run 2: 22.8 to 26.1 ms) but run 2 sat higher than run 1 for static and (b). The static p95 is about 12 to 15 ms, so 2 to 3 ms is 20%; on (b) it is 3.7 ms. The 304-vs-200 block of run 2 was also slower across the board (200 p50 of 9.8 ms against 6.4 ms in run 1), so the machine was in a slower state during part of run 2 (Windows scheduling, thermal state, background load; not identified).
- p50 is stable (static +2.9%, (a) +6.2%, (b) -3.5%).
- The maximum sustainable rate is a coarse measure (x1.5 ladder, one 20 s run per rung) and differed between the two runs for (a) and (b): 252 vs 378 and 850 vs 1,275. For (b), the lowest failing rung was 1,275 in run 1 (421 dropped) and 1,912 in run 2 (5,511 dropped), so the real limit is somewhere between 850 and 1,912 req/s; treat it as "roughly 0.9 to 1.3 thousand req/s". The static server passed 1,275 and failed 1,912 in both runs (6,679 and 1,922 dropped).

## Before and after the `suppliers` table

| | before (aggregation on every request) | after (`suppliers` table) |
|---|---|---|
| Postgres, supplier list first page (EXPLAIN ANALYZE) | 180.9 ms | 0.03 ms |
| Postgres, supplier list cursor page | 140.4 ms | 0.08 ms |
| Postgres, search `q`, a term with many matches | 221.5 ms | 0.3 ms |
| Postgres, search `q`, a term with no match (worst case, scans all 21,677 rows) | not measured separately (about 221 ms) | 68.6 ms |
| HTTP p95 of `suppliers_list` at 100 req/s, (b) run 1 / run 2 | 200.7 / 173.1 ms | 13.6 / 16.7 ms |
| HTTP p95 of `suppliers_search` at 100 req/s, (b) run 1 / run 2 | 401.8 / 403.8 ms | 97.1 / 87.2 ms |
| Overall p95 at 100 req/s, (b) | 27.95 / 30.57 ms | 21.91 / 25.60 ms |
| Overall p99 at 100 req/s, (b) | 272.3 / 278.1 ms | 85.5 / 73.4 ms |
| Max sustainable rate, (b) with indexes | 168 / 168 req/s | 850 / 1,275 req/s |
| Max sustainable rate, (a) full-scan cost | 112 / 112 req/s | 252 / 378 req/s |
| Postgres CPU mid-run at 100 req/s, (b) | about 280% of a core | about 5 to 8% of a core (one docker stats sample per run; the Go server used about 0.11 cores) |

The supplier list is no longer the bottleneck: it went from above the 50 ms line (Fable review of phase 3, item 6) to well below it. The one path still above 50 ms is a `q` search whose term matches nothing (68.6 ms in Postgres): it walks every row of `suppliers` and applies `translate()` to each label, and the HTTP p95 of `suppliers_search` (about 90 to 100 ms) comes from those. It was not optimized further here. The now-dominant p99 (about 75 to 85 ms) is that search endpoint, 2% of the mix. The static server still wins on raw speed (1,275 req/s sustained against 850 to 1,275 for the API, 3 ms p50 against 5.5 ms), and moves about 70 times more bytes per response (1,402 KB against 20.1 KB). At 226 thousand records Postgres is not needed for performance; the API's value is filters, cursor pagination, supplier search across deputies and small responses.

Checks done on the new table: the loader verifies it against `supplier_cells` (and its row count against the labels of `fornecedores.json`) in the load transaction and when it is added to an existing schema; a tampered or missing row is refused (tests added). The contract test against the real publication passes with it (21,677 labels, 123,504 cells equal to `fornecedores.json`, 226,510 records equal to `despesas.json`).

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
  - Suppliers: lists use `limit=100` (30% with a cursor), searches (`q`, 40% of list requests) use `limit=50`; details pick keys skewed to the most-used suppliers (the top one has 5,177 cells).
  - 404s: 2% of profile requests ask for a missing deputy and 5% of supplier details for an unknown key; they count as expected.
- **Step (0) static baseline.** `api/bench/static` (Go `http.FileServer`) serves the same JSON files on loopback; each request maps to the file the site would read (profile -> `summary.json` 1.7 MB, expense page -> `deputados/<id>/despesas.json`, suppliers -> `fornecedores.json` 3.2 MB, meta -> `index.json`). The 30 deputies without data have no file and return 404. It returns whole files, so it is faster per request but sends about 70 times more bytes and the client must filter and paginate. No static equivalent of `suppliers_search`.
- **Step (a) "full-scan cost on 226 thousand rows".** The API against `clareia_api_bench_noidx`, a copy of the real database (`CREATE DATABASE ... TEMPLATE`) in which every index and primary/unique constraint on `expenses`, `supplier_cells`, `deputy_months`, `deputy_categories` and `suppliers` was dropped (kept: `deputies_pkey`, `publication_pkey`), then `ANALYZE`. The real database was never altered by the benchmark; the copy is dropped at the end of `run.ps1`. This is the price of scanning, not an optimization.
- **Step (b) with indexes.** The real setup (`clareia_api`, role `clareia_api_ro`, pool of 10).
- **Per step:** 20 s warm-up at the reference rate, then **5 runs of 90 s** at 100 req/s (the first benchmark used 3 runs of 45 s); tables show median with min to max. Then a rate ladder: 20 s per rung from 50 req/s, each rung 1.5x the last, until the first invalid run. Max sustainable rate = last valid rung; one run per rung.
- **304 versus 200** (`etag.js`, step b): the same URL with and without `If-None-Match` at 40 req/s for 20 s each, 3 runs. Latency only.
- **EXPLAIN (ANALYZE, BUFFERS)** of every query the server issues (`explain.sql`), second execution. Run 1's EXPLAIN used the earlier query list (the aggregation queries only); run 2's includes the new `suppliers` queries next to the old ones, labelled.
- Reproduce: `powershell -File api/bench/run.ps1 -Name runN`, then `api/bench/tables.ps1 -Name runN`. Needs the container with an active publication that has the `suppliers` table (run `load.ps1` on its folder once), `~/.clareia/api-pg.env`, k6, Go. Credentials never leave the process. About 45 minutes per run.

## Not measured

- Real network, TLS, a reverse proxy, a CDN, other clients. Loopback to Postgres crosses the WSL2 VM boundary.
- A cold cache or disk (EXPLAIN shows `shared hit` almost everywhere).
- Rate limiting (off), authentication, the publication switch under load.
- Endpoints not in the mix: `GET /v1/deputies` with filters, `month` and `category` filters, `/v1/expenses/{id}`, `/v1/categories`, `/healthz`.
- Memory, GC, pool saturation as such (pool is 10), long soak runs, other Postgres settings.
- Any mix other than the assumed one. Search with terms that match nothing is the slowest remaining path and is 2% of this mix.
- Postgres CPU beyond one `docker stats` sample per run.
- Day-to-day variation: two full runs, back to back, which already differ by up to 22% in p95 on two steps.

## Suggested resume bullet (suggestion, check it before use)

> Built a read-only Go + PostgreSQL API over 226,510 public expense records and load-tested it with k6 (open model, assumed 60/25/10/5 mix, one laptop, loopback): p50 5.5 ms and p95 22 to 26 ms at 100 req/s, 850 to 1,275 req/s sustained with zero dropped requests; load-testing exposed a 180 ms per-request supplier aggregation, and a pre-aggregated table cut it to 0.03 ms and raised capacity from 168 to at least 850 req/s. A plain static-file server on the same machine sustained 1,275 req/s.

## Tables per run, after the `suppliers` table (generated by `tables.ps1` from the stored k6 summaries)

### Run 1

#### Runs per step at the reference rate (run1): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.14 (1.53 to 3.29) | 12.03 (10.56 to 16.20) | 21.51 (20.40 to 24.89) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 1,401.7 | 0.26 (0.21 to 0.29) | 0.36 (0.30 to 0.41) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 6.74 (6.67 to 6.84) | 36.71 (36.29 to 36.78) | 94.71 (94.13 to 95.08) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 20.1 | 0.16 (0.15 to 0.16) | 0.09 (0.08 to 0.09) |
| (b) API, with indexes | 100/s | 5.68 (5.59 to 7.12) | 21.91 (21.69 to 24.43) | 85.48 (84.88 to 88.32) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 20.1 | 0.16 (0.15 to 0.17) | 0.09 (0.08 to 0.09) |

#### p95 by endpoint at the reference rate, median of 3 runs, ms

| step | profile | expenses | expenses_worst | suppliers_list | suppliers_search | supplier_detail | meta |
|---|---|---|---|---|---|---|---|
| (0) static files | 11.83 | 4.57 | 11.04 | 20.45 | - | 20.84 | 3.22 |
| (a) API, full-scan cost (no extra indexes) | 10.48 | 40.09 | 41.86 | 12.17 | 108.06 | 24.19 | 6.88 |
| (b) API, with indexes | 19.14 | 20.59 | 20.41 | 13.60 | 97.10 | 17.31 | 14.27 |

#### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s

**(0) static files**: max sustainable rate 1275 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 4.27 | 24.86 | 31.59 | 0 | 0.000% | yes | 0.17 | 0.22 |
| 75 | 75.0 | 3.40 | 17.38 | 28.39 | 0 | 0.000% | yes | 0.23 | 0.29 |
| 112 | 112.0 | 3.48 | 16.38 | 26.44 | 0 | 0.000% | yes | 0.45 | 0.48 |
| 168 | 168.0 | 1.24 | 7.57 | 20.13 | 0 | 0.000% | yes | 0.28 | 0.47 |
| 252 | 252.0 | 2.84 | 10.44 | 20.58 | 0 | 0.000% | yes | 0.67 | 0.87 |
| 378 | 378.0 | 2.83 | 9.20 | 17.26 | 0 | 0.000% | yes | 0.98 | 1.39 |
| 567 | 567.0 | 2.76 | 8.61 | 15.48 | 0 | 0.000% | yes | 1.46 | 1.98 |
| 850 | 848.9 | 2.77 | 10.10 | 17.91 | 0 | 0.000% | yes | 2.21 | 2.89 |
| 1275 | 1,274.9 | 3.29 | 23.31 | 38.58 | 0 | 0.000% | yes | 3.88 | 4.68 |
| 1912 | 1,547.3 | 257.85 | 689.97 | 876.66 | 6679 | 0.000% | no | 7.88 | 6.55 |

**(a) API, full-scan cost (no extra indexes)**: max sustainable rate 252 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 8.71 | 36.22 | 83.46 | 0 | 0.000% | yes | 0.09 | 0.08 |
| 75 | 75.0 | 7.42 | 34.79 | 87.03 | 0 | 0.000% | yes | 0.12 | 0.08 |
| 112 | 112.0 | 6.48 | 35.83 | 92.62 | 0 | 0.000% | yes | 0.16 | 0.2 |
| 168 | 167.9 | 6.91 | 45.10 | 113.12 | 0 | 0.000% | yes | 0.23 | 0.16 |
| 252 | 251.3 | 8.10 | 93.39 | 139.53 | 0 | 0.000% | yes | 0.42 | 0.25 |
| 378 | 321.4 | 710.08 | 1,011.58 | 1,072.74 | 796 | 0.000% | no | 0.58 | 0.6 |

**(b) API, with indexes**: max sustainable rate 850 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 5.93 | 22.49 | 82.76 | 0 | 0.000% | yes | 0.08 | 0.07 |
| 75 | 75.0 | 4.92 | 22.49 | 82.58 | 0 | 0.000% | yes | 0.09 | 0.11 |
| 112 | 112.0 | 5.10 | 21.99 | 81.97 | 0 | 0.000% | yes | 0.16 | 0.1 |
| 168 | 167.9 | 5.31 | 17.92 | 87.82 | 0 | 0.000% | yes | 0.23 | 0.16 |
| 252 | 251.9 | 4.53 | 17.73 | 89.63 | 0 | 0.000% | yes | 0.32 | 0.19 |
| 378 | 376.8 | 4.45 | 15.92 | 94.45 | 0 | 0.000% | yes | 0.44 | 0.27 |
| 567 | 566.9 | 4.35 | 12.67 | 101.46 | 0 | 0.000% | yes | 0.68 | 0.4 |
| 850 | 846.2 | 4.76 | 10.37 | 114.35 | 0 | 0.000% | yes | 1.03 | 0.61 |
| 1275 | 1,237.8 | 180.76 | 267.31 | 299.58 | 421 | 0.000% | no | 1.79 | 1.03 |

#### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms

| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |
|---|---|---|---|---|
| profile | 6.40 (5.84 to 8.29) | 21.51 (19.16 to 24.65) | 3.40 (3.34 to 3.88) | 13.25 (12.07 to 16.75) |
| expenses_worst | 6.91 (6.84 to 8.75) | 22.75 (20.05 to 23.36) | 2.99 (2.81 to 3.82) | 11.70 (10.99 to 14.21) |
| suppliers_list | 5.17 (4.44 to 6.73) | 17.90 (13.42 to 20.22) | 3.14 (3.04 to 3.91) | 12.12 (9.87 to 15.50) |
dropped iterations: 0/0/0

### Run 2

#### Runs per step at the reference rate (run2): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.23 (3.14 to 3.27) | 14.69 (13.57 to 14.95) | 23.98 (23.18 to 24.19) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 1,401.7 | 0.31 (0.31 to 0.33) | 0.40 (0.39 to 0.42) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 7.16 (6.79 to 7.80) | 34.31 (33.66 to 36.73) | 77.56 (75.43 to 84.37) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 20.1 | 0.10 (0.09 to 0.14) | 0.06 (0.05 to 0.09) |
| (b) API, with indexes | 100/s | 5.48 (5.22 to 12.89) | 25.60 (22.82 to 26.06) | 73.40 (73.02 to 78.05) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 20.1 | 0.11 (0.11 to 0.14) | 0.06 (0.05 to 0.07) |

#### p95 by endpoint at the reference rate, median of 3 runs, ms

| step | profile | expenses | expenses_worst | suppliers_list | suppliers_search | supplier_detail | meta |
|---|---|---|---|---|---|---|---|
| (0) static files | 14.48 | 5.23 | 12.48 | 24.85 | - | 24.34 | 4.23 |
| (a) API, full-scan cost (no extra indexes) | 17.58 | 38.48 | 39.62 | 15.85 | 94.60 | 25.13 | 12.91 |
| (b) API, with indexes | 22.89 | 21.87 | 22.74 | 16.71 | 87.20 | 17.06 | 17.27 |

#### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s

**(0) static files**: max sustainable rate 1275 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 2.46 | 15.49 | 23.97 | 0 | 0.000% | yes | 0.15 | 0.23 |
| 75 | 75.0 | 2.74 | 19.14 | 26.99 | 0 | 0.000% | yes | 0.25 | 0.33 |
| 112 | 112.0 | 3.15 | 14.51 | 22.11 | 0 | 0.000% | yes | 0.39 | 0.49 |
| 168 | 168.0 | 3.04 | 11.34 | 19.53 | 0 | 0.000% | yes | 0.48 | 0.62 |
| 252 | 252.0 | 2.93 | 12.18 | 21.44 | 0 | 0.000% | yes | 0.74 | 0.94 |
| 378 | 378.0 | 2.87 | 10.66 | 18.20 | 0 | 0.000% | yes | 1.08 | 1.47 |
| 567 | 566.9 | 2.73 | 8.98 | 16.82 | 0 | 0.000% | yes | 1.46 | 1.91 |
| 850 | 849.7 | 2.69 | 10.55 | 24.44 | 0 | 0.000% | yes | 2.12 | 2.8 |
| 1275 | 1,275.0 | 1.61 | 14.40 | 33.64 | 0 | 0.000% | yes | 2.64 | 3.99 |
| 1912 | 1,792.8 | 2.84 | 357.43 | 549.98 | 1922 | 0.000% | no | 4.99 | 6.58 |

**(a) API, full-scan cost (no extra indexes)**: max sustainable rate 378 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 8.87 | 36.07 | 71.85 | 0 | 0.000% | yes | 0.06 | 0.08 |
| 75 | 75.0 | 14.09 | 37.35 | 75.48 | 0 | 0.000% | yes | 0.08 | 0.07 |
| 112 | 112.0 | 6.65 | 32.19 | 73.91 | 0 | 0.000% | yes | 0.09 | 0.07 |
| 168 | 167.9 | 6.39 | 33.75 | 80.66 | 0 | 0.000% | yes | 0.16 | 0.11 |
| 252 | 251.8 | 5.79 | 39.85 | 92.08 | 0 | 0.000% | yes | 0.26 | 0.18 |
| 378 | 375.6 | 23.74 | 108.67 | 143.99 | 0 | 0.000% | yes | 0.56 | 0.31 |
| 567 | 387.8 | 1,204.74 | 1,974.40 | 2,050.46 | 2768 | 0.000% | no | 0.55 | 0.96 |

**(b) API, with indexes**: max sustainable rate 1275 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 8.25 | 25.13 | 75.30 | 0 | 0.000% | yes | 0.09 | 0.08 |
| 75 | 75.0 | 6.34 | 23.14 | 73.07 | 0 | 0.000% | yes | 0.11 | 0.07 |
| 112 | 112.0 | 8.61 | 22.81 | 73.42 | 0 | 0.000% | yes | 0.12 | 0.07 |
| 168 | 167.9 | 3.69 | 19.56 | 72.20 | 0 | 0.000% | yes | 0.15 | 0.11 |
| 252 | 252.0 | 3.12 | 17.60 | 72.73 | 0 | 0.000% | yes | 0.16 | 0.11 |
| 378 | 377.0 | 2.63 | 14.86 | 74.70 | 0 | 0.000% | yes | 0.25 | 0.17 |
| 567 | 566.9 | 3.66 | 14.76 | 81.60 | 0 | 0.000% | yes | 0.43 | 0.33 |
| 850 | 847.1 | 3.61 | 18.57 | 87.70 | 0 | 0.000% | yes | 0.58 | 0.45 |
| 1275 | 1,270.1 | 3.64 | 16.26 | 98.66 | 0 | 0.000% | yes | 1.09 | 0.72 |
| 1912 | 1,578.8 | 446.27 | 790.86 | 901.18 | 5511 | 0.000% | no | 1.67 | 1.67 |

#### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms

| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |
|---|---|---|---|---|
| profile | 9.81 (9.48 to 12.17) | 27.77 (27.23 to 29.21) | 7.25 (6.77 to 7.37) | 18.29 (13.83 to 20.79) |
| expenses_worst | 10.07 (9.80 to 12.09) | 29.47 (27.37 to 29.75) | 7.29 (7.05 to 7.56) | 16.31 (14.62 to 24.44) |
| suppliers_list | 8.66 (8.39 to 11.60) | 27.05 (18.32 to 28.50) | 7.27 (6.88 to 7.72) | 16.83 (10.40 to 17.19) |
dropped iterations: 0/0/0


## EXPLAIN (ANALYZE, BUFFERS) after the table

Run 2 (`results/run2/explain-with-indexes.txt`), with indexes: the new queries `/v1/suppliers` runs are an `Index Scan using suppliers_pkey` with `LIMIT` for the list (first page 0.03 ms, cursor page 0.08 ms) and for a search whose term matches early (0.3 ms). A term with no match filters all 21,677 rows with `strpos(translate(lower(label), ...))` and takes 68.6 ms (measured once by hand with the same SQL). The old aggregation queries are kept in `explain.sql` for comparison and measured 148 to 191 ms in run 2, 188 to 255 ms in run 1; the pre-table analysis of those plans (a `Sort` through 14.5 MB of temp files and a `GroupAggregate` over 123,504 rows) is in the appendix. All other queries are unchanged: deputy, months and categories under 0.3 ms; expense page 0.04 to 0.1 ms with indexes against 22 to 25 ms without; supplier detail about 3 ms with indexes against 12 ms without.

Run 1 and run 2 EXPLAIN files are in `results/run1/` and `results/run2/`.

## Files

`run.ps1`, `tables.ps1`, `mix.js`, `etag.js`, `fixture.sql`, `explain.sql`, `static/main.go`; `results/run1`, `results/run2` (after the table); `results/before-suppliers-table/run1`, `run2` and `RESULTS-before.md` (the first benchmark, kept as it was written).

---

# Appendix: the first benchmark, before the `suppliers` table (3 runs of 45 s per step, commit `58456cf`)

Numbers and prose below are the earlier `RESULTS.md`, unchanged apart from the heading level; its raw files are in `results/before-suppliers-table/`.


## Clareia public API: benchmark (Phase 4)

Everything here is a measurement of Go + pgx + JSON serialization over loopback. It does not measure disk (all data is cached in memory), network, TLS, a proxy or real users. The traffic mix is an assumption, not observed traffic: the site is not launched. Rate limiting is off.

### Environment

| item | value |
|---|---|
| CPU | Intel Core i9-14900HX, 24 cores / 32 logical processors |
| RAM | 31.7 GB |
| Disk | NVMe Micron 2500 (MTFDKBA1T0QGN), SSD, 954 GB |
| OS | Windows 11 Home 10.0.26200 |
| Docker / WSL2 | Docker 29.0.1 (client and server); WSL 2.6.1.0, kernel 6.6.87.2-1. Postgres runs in the WSL2 VM, so loopback to it crosses the VM boundary |
| Power | plan "Balanced"; plugged in (battery status 2 = AC, 93% charge) |
| Go / Postgres / k6 | go1.27.4 windows/amd64; PostgreSQL 16.16 (Debian, container `clareia-api-pg`); k6 v2.4.0 |
| Code | commit `58456cf` (the harness commit; `api/cmd` and `api/internal` are identical to main at `69d1663`, the branch base), server built with `-X main.version=bench-58456cf` |
| Publication | `b571fe73c261` (226,510 expense records, 592 deputies, 562 with data) |
| Not recorded | Docker/WSL CPU and memory limits for the Postgres VM (unknown), Postgres settings (appear to be the image defaults: the supplier aggregation sorts through 14.5 MB of temp files, consistent with the 4 MB `work_mem` default), antivirus and other background load (unknown) |

Raw environment and per-run process CPU are in `results/run*/env.json` and `results/run*/*/*.proc.json`. CPU numbers are the CPU time of the server and of k6 divided by wall time (1.0 = one core fully busy); the Postgres figure is one `docker stats` sample taken mid-run, in percent of one core, so 280% means about 2.8 cores.

### Method

- **Open model.** k6 `constant-arrival-rate`. A run is valid only with zero `dropped_iterations`, error rate under 0.1% and p99 under 1 s (thresholds in `mix.js`; k6 exits non-zero otherwise).
- **Assumed mix.** 60% deputy profile, 25% expense pages, 10% suppliers (half list or search, half detail), 5% meta. Ids come from a PRNG seeded with `20261118` and the global iteration number, so every run sends the same sequence of requests. Ids are skewed (`index = floor(N * u^2)`) so a few deputies and suppliers are popular; that skew is also an assumption.
  - Expense pages: 5% are the worst case (deputy 220554, 1,885 records, last page of 100), 25% of the rest use a random cursor, the rest are first pages. `limit=100`.
  - Suppliers: lists use `limit=100` (30% with a cursor), searches (`q`, 40% of list requests) use `limit=50`; details pick keys skewed towards the most-used suppliers (the top one has 5,177 cells).
  - 404s: 2% of profile requests ask for a deputy that does not exist and 5% of supplier details ask for an unknown key. They count as expected (the status check and `http_req_failed` both treat 404 as success for those requests).
- **Step (0) static baseline.** `api/bench/static` (Go `http.FileServer`) serves the same JSON files of the publication folder on loopback. A static site has no query endpoints, so each request maps to the file the site would read: profile -> `summary.json` (1.7 MB, all deputies), expense page -> `deputados/<id>/despesas.json` (whole file), suppliers list/detail -> `fornecedores.json` (3.2 MB), meta -> `index.json`. The 30 deputies without data have no file there and return 404. The baseline returns whole files (about 1,391 KB per response on average against 20.5 KB for the API), so it is faster per request but moves about 68 times more bytes, and the client must filter and paginate by itself. There is no static equivalent of `suppliers_search`.
- **Step (a) "full-scan cost on 226 thousand rows".** The same API against `clareia_api_bench_noidx`, a database created with `CREATE DATABASE ... TEMPLATE clareia_api` from the real one, in which every index and primary/unique constraint on `expenses`, `supplier_cells`, `deputy_months` and `deputy_categories` was dropped (kept: `deputies_pkey`, `publication_pkey`; see `results/run*/noidx-remaining-indexes.txt`) and `ANALYZE` was run. The real database and its active publication were never altered; the copy is dropped at the end of `run.ps1`. This is the price of scanning, not an optimization: nobody would run this setup.
- **Step (b) with indexes.** The real setup (`clareia_api`, publication `b571fe73c261`, read-only role `clareia_api_ro`, pool of 10 connections).
- **Per step:** 20 s warm-up at the reference rate (not counted), then 3 runs of 45 s at the reference rate of 100 req/s. Tables show the median of the 3 runs with min and max. Then a rate ladder: 20 s per rung starting at 50 req/s, each rung 1.5x the last, until the first invalid run. "Max sustainable rate" is the last valid rung; the true limit lies between it and the next rung (up to 50% higher), and each rung is a single run.
- **304 versus 200** (`etag.js`, step b only): the same URL requested with and without `If-None-Match` at 40 req/s for 20 s each, 3 runs. It reports latency, not throughput.
- **EXPLAIN (ANALYZE, BUFFERS)** of every query the server issues (`explain.sql`), in both databases, second execution (warm). The complete output is in `results/run*/explain-*.txt`.
- Reproduce everything: `powershell -File api/bench/run.ps1 -Name runN`, then `api/bench/tables.ps1 -Name runN`. It needs the container `clareia-api-pg` with an active publication, `~/.clareia/api-pg.env`, k6 and Go. Credentials stay inside the process and are never written. About 25 minutes per run.

### Headline numbers (reference rate 100 req/s, median of 3 runs of 45 s)

| step | p50 ms (run 1 / run 2) | p95 ms (run 1 / run 2) | p99 ms (run 1 / run 2) | p95 change, run 2 vs run 1 | max sustainable req/s (run 1 / run 2) |
|---|---|---|---|---|---|
| (0) static files | 3.27 / 3.28 | 10.37 / 12.44 | 19.53 / 22.28 | +20.0% | 1,275 / 1,275 |
| (a) API, full-scan cost | 7.78 / 8.02 | 86.34 / 97.81 | 304.98 / 340.09 | +13.3% | 112 / 112 |
| (b) API, with indexes | 5.84 / 5.75 | 27.95 / 30.57 | 272.32 / 278.09 | +9.4% | 168 / 168 |

All runs at the reference rate had zero dropped iterations and 0.000% errors (achieved 100.0 req/s each time). The first rung above the maximum failed in every ladder (dropped iterations in run 1 / run 2: static at 1,912 req/s 5,606 / 5,998; (a) at 168 req/s 59 / 66; (b) at 252 req/s 76 / 113).

Reproducibility: the second full run matched the first on the maximum sustainable rate of every step and on p50 (within about 3%), but p95 differed by +20.0% (static), +13.3% (a) and +9.4% (b). **The "within 10% on p95" criterion is met only for (b).** The causes are visible in the data: the static p95 is about 10 ms, where a 2 ms shift is 20%; and in the API steps the p95 sits right at the edge of the supplier list and search requests (5% of the mix, 150 to 400 ms each, see below), so a small shift moves the percentile a lot. Medians and the ladder are stable; treat the p95 of these runs as plus or minus 15%.

### What the numbers say

- The static baseline wins on raw speed, as expected: about 3 ms p50 and 1,275 req/s sustained (the machine was the limit: k6 used 4.6 cores and the file server 3.7 at that rate), against 5.8 ms p50 and 168 req/s for the API. At 226 thousand records Postgres is not needed for performance. The API's value is what the files cannot do: filters, cursor pagination, supplier search across deputies, and answering with 20 KB instead of 1.4 MB.
- **The supplier list aggregation is the expensive query: 140 to 230 ms inside Postgres, far above the 50 ms threshold, with or without indexes.** `/v1/suppliers` re-aggregates all 123,504 `supplier_cells` rows (`GROUP BY label, supplier_key`, sort, then limit) on every request: a first page takes about 181 ms (it sorts through 14.5 MB of temp files), a cursor page about 140 ms, a `q` search about 221 ms (parallel scan, with the accent-folding `translate()` on every label). It is 5% of the mix and it alone sets the p99 (about 270 ms at 100 req/s) and the capacity: with indexes, at 100 req/s Postgres averaged about 280% of a core (about 1,470% at 252 req/s) while the Go server used 0.15 cores. The limit of this API is Postgres CPU on that query, not Go or JSON. A table pre-aggregated at load time would remove it; that was not done here.
- Indexes help the per-deputy queries, which is expected and not a finding about the design: the expense page goes from about 23 to 25 ms of full scan to 0.04 to 0.1 ms, `/v1/expenses/{id}` from 25 ms to 0.02 ms, a supplier detail from 12 to 3 ms. At the HTTP level the p95 of expense pages goes from 72 and 87 ms to 14 and 15 ms, and the max sustainable rate from 112 to 168 req/s. The supplier list does not change because it needs every row either way.
- 304 versus 200 (step b, 40 req/s, medians of 3 runs, ms): profile 3.1 to 3.8 against 6.2; worst-case expense page 3.4 against 6.7 to 6.9; supplier list 3.3 to 3.5 against 155. The 304 still opens a transaction and reads the active publication, so it saves the body query and the serialization, not the round trip. For the cheap endpoints the p95 is about the same for 304 (11 to 14 ms) and 200 (10 to 18 ms) because it is dominated by scheduling jitter.

### Not measured

- Real network, TLS, a reverse proxy, a CDN, or any client other than k6 on the same host. Loopback to Postgres crosses the WSL2 VM boundary.
- A cold cache or disk: the EXPLAIN output shows `shared hit` for almost everything, and the OS cache held the files.
- Rate limiting (off, as required), authentication, and the publication switch under load.
- Endpoints and parameters not in the mix: `GET /v1/deputies` with `uf`/`party`, `month` and `category` filters, `/v1/expenses/{id}`, `/v1/categories`, `/healthz`.
- Memory, GC, pool saturation as such (the pool is 10; a larger pool was not tried), long soak runs, and other Postgres settings (`work_mem`, parallel workers).
- Any mix other than the assumed one. With less supplier search the numbers improve a lot; with more they get worse.
- Postgres CPU beyond one `docker stats` sample per run.
- Variation between days or machine states: only two full runs, back to back.

### Suggested resume bullet (suggestion, check it before use)

> Built a read-only Go + PostgreSQL API over 226,510 public expense records and load-tested it with k6 (open model, assumed 60/25/10/5 mix, one laptop, loopback): p50 5.8 ms and p95 28 to 31 ms at 100 req/s, 168 req/s sustained with zero dropped requests; a plain static-file server on the same machine sustained 1,275 req/s, and the slowest query (supplier list aggregation, about 180 ms) was found with EXPLAIN ANALYZE.

### Tables per run (generated by `tables.ps1` from the stored k6 summaries)

#### Run 1

﻿### Three runs per step (run1): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.27 (3.24 to 3.39) | 10.37 (9.12 to 13.25) | 19.53 (17.64 to 21.63) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 1,391.1 | 0.30 (0.29 to 0.34) | 0.40 (0.38 to 0.41) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 7.78 (6.86 to 7.99) | 86.34 (65.79 to 89.05) | 304.98 (270.69 to 317.24) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.18 (0.10 to 0.18) | 0.10 (0.08 to 0.11) |
| (b) API, with indexes | 100/s | 5.84 (5.73 to 5.87) | 27.95 (27.55 to 30.19) | 272.32 (249.83 to 276.59) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.15 (0.14 to 0.17) | 0.09 (0.08 to 0.10) |

##### p95 by endpoint at the reference rate, median of 3 runs, ms

| step | profile | expenses | expenses_worst | suppliers_list | suppliers_search | supplier_detail | meta |
|---|---|---|---|---|---|---|---|
| (0) static files | 10.37 | 3.71 | 8.49 | 19.53 | - | 17.20 | 3.03 |
| (a) API, full-scan cost (no extra indexes) | 10.29 | 72.14 | 68.16 | 228.63 | 536.02 | 28.40 | 6.65 |
| (b) API, with indexes | 12.58 | 14.44 | 14.50 | 200.71 | 401.82 | 11.83 | 10.93 |

##### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s

**(0) static files**: max sustainable rate 1275 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 3.37 | 15.25 | 25.83 | 0 | 0.000% | yes | 0.16 | 0.23 |
| 75 | 75.0 | 3.76 | 17.73 | 29.24 | 0 | 0.000% | yes | 0.29 | 0.38 |
| 112 | 112.0 | 3.39 | 14.69 | 26.61 | 0 | 0.000% | yes | 0.34 | 0.54 |
| 168 | 168.0 | 3.24 | 12.95 | 24.13 | 0 | 0.000% | yes | 0.53 | 0.67 |
| 252 | 251.9 | 3.21 | 14.88 | 30.23 | 0 | 0.000% | yes | 0.91 | 1.18 |
| 378 | 378.0 | 2.90 | 12.65 | 24.22 | 0 | 0.000% | yes | 1.17 | 1.65 |
| 567 | 566.9 | 2.79 | 12.16 | 35.93 | 0 | 0.000% | yes | 1.62 | 2.11 |
| 850 | 849.9 | 2.69 | 8.76 | 16.18 | 0 | 0.000% | yes | 2.1 | 2.65 |
| 1275 | 1,274.9 | 3.20 | 19.89 | 34.63 | 0 | 0.000% | yes | 3.69 | 4.58 |
| 1912 | 1,599.6 | 236.46 | 671.85 | 894.26 | 5606 | 0.000% | no | 7.97 | 6.37 |

**(a) API, full-scan cost (no extra indexes)**: max sustainable rate 112 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 8.25 | 52.55 | 242.42 | 0 | 0.000% | yes | 0.08 | 0.07 |
| 75 | 74.5 | 8.04 | 61.07 | 284.72 | 0 | 0.000% | yes | 0.13 | 0.12 |
| 112 | 112.0 | 7.72 | 79.93 | 313.26 | 0 | 0.000% | yes | 0.19 | 0.1 |
| 168 | 156.9 | 27.97 | 464.47 | 687.18 | 59 | 0.000% | no | 0.32 | 0.21 |

**(b) API, with indexes**: max sustainable rate 168 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 6.41 | 31.63 | 234.95 | 0 | 0.000% | yes | 0.08 | 0.09 |
| 75 | 74.5 | 5.78 | 26.81 | 234.12 | 0 | 0.000% | yes | 0.13 | 0.1 |
| 112 | 112.0 | 5.87 | 19.50 | 254.47 | 0 | 0.000% | yes | 0.16 | 0.1 |
| 168 | 164.4 | 6.16 | 19.64 | 367.13 | 0 | 0.000% | yes | 0.28 | 0.19 |
| 252 | 237.8 | 7.30 | 300.96 | 529.58 | 76 | 0.000% | no | 0.43 | 0.28 |

##### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms

| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |
|---|---|---|---|---|
| profile | 6.21 (6.19 to 6.26) | 12.24 (10.07 to 12.52) | 3.84 (3.78 to 5.25) | 13.46 (10.78 to 18.09) |
| expenses_worst | 6.88 (6.87 to 6.91) | 17.89 (12.22 to 20.53) | 3.45 (2.97 to 4.67) | 13.19 (11.23 to 15.66) |
| suppliers_list | 154.59 (154.57 to 164.82) | 240.90 (234.86 to 298.54) | 3.26 (3.19 to 5.54) | 13.08 (10.67 to 14.39) |
dropped iterations: 0/0/0

#### Run 2

﻿### Three runs per step (run2): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.28 (3.26 to 3.40) | 12.44 (11.56 to 15.95) | 22.28 (20.89 to 24.10) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 1,391.2 | 0.28 (0.27 to 0.35) | 0.38 (0.37 to 0.45) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 8.02 (7.77 to 8.23) | 97.81 (90.63 to 98.14) | 340.09 (327.88 to 346.38) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.19 (0.16 to 0.19) | 0.10 (0.10 to 0.11) |
| (b) API, with indexes | 100/s | 5.75 (5.69 to 5.84) | 30.57 (27.88 to 34.49) | 278.09 (275.11 to 282.49) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.16 (0.15 to 0.16) | 0.10 (0.09 to 0.10) |

##### p95 by endpoint at the reference rate, median of 3 runs, ms

| step | profile | expenses | expenses_worst | suppliers_list | suppliers_search | supplier_detail | meta |
|---|---|---|---|---|---|---|---|
| (0) static files | 12.40 | 3.74 | 10.93 | 21.56 | - | 22.22 | 2.77 |
| (a) API, full-scan cost (no extra indexes) | 9.98 | 87.13 | 74.53 | 266.06 | 789.93 | 29.64 | 6.82 |
| (b) API, with indexes | 12.69 | 15.28 | 11.17 | 173.08 | 403.81 | 9.19 | 10.10 |

##### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s

**(0) static files**: max sustainable rate 1275 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 3.20 | 14.57 | 24.40 | 0 | 0.000% | yes | 0.15 | 0.25 |
| 75 | 75.0 | 3.71 | 16.57 | 24.17 | 0 | 0.000% | yes | 0.27 | 0.39 |
| 112 | 112.0 | 3.20 | 15.99 | 23.26 | 0 | 0.000% | yes | 0.38 | 0.5 |
| 168 | 168.0 | 2.93 | 11.49 | 21.09 | 0 | 0.000% | yes | 0.48 | 0.61 |
| 252 | 252.0 | 2.91 | 11.17 | 18.68 | 0 | 0.000% | yes | 0.68 | 0.96 |
| 378 | 378.0 | 2.87 | 10.65 | 18.81 | 0 | 0.000% | yes | 1.11 | 1.37 |
| 567 | 566.9 | 1.27 | 6.81 | 13.56 | 0 | 0.000% | yes | 1.02 | 1.69 |
| 850 | 849.8 | 2.84 | 10.11 | 19.05 | 0 | 0.000% | yes | 2.24 | 3.03 |
| 1275 | 1,275.0 | 3.21 | 20.81 | 33.58 | 0 | 0.000% | yes | 3.76 | 4.81 |
| 1912 | 1,581.2 | 261.20 | 686.38 | 897.94 | 5998 | 0.000% | no | 7.94 | 6.46 |

**(a) API, full-scan cost (no extra indexes)**: max sustainable rate 112 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 9.14 | 43.55 | 230.51 | 0 | 0.000% | yes | 0.1 | 0.09 |
| 75 | 74.4 | 7.69 | 45.73 | 254.42 | 0 | 0.000% | yes | 0.14 | 0.1 |
| 112 | 112.0 | 8.02 | 85.75 | 306.52 | 0 | 0.000% | yes | 0.17 | 0.2 |
| 168 | 155.2 | 52.72 | 483.14 | 812.45 | 66 | 0.000% | no | 0.36 | 0.21 |

**(b) API, with indexes**: max sustainable rate 168 req/s

| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 50.0 | 6.24 | 30.81 | 222.87 | 0 | 0.000% | yes | 0.09 | 0.07 |
| 75 | 74.4 | 5.88 | 25.12 | 238.95 | 0 | 0.000% | yes | 0.14 | 0.08 |
| 112 | 112.0 | 5.86 | 27.65 | 250.91 | 0 | 0.000% | yes | 0.17 | 0.1 |
| 168 | 166.7 | 5.65 | 24.95 | 316.67 | 0 | 0.000% | yes | 0.28 | 0.17 |
| 252 | 231.7 | 6.80 | 291.26 | 610.51 | 113 | 0.000% | no | 0.35 | 0.28 |

##### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms

| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |
|---|---|---|---|---|
| profile | 6.16 (6.03 to 6.25) | 10.05 (9.00 to 11.78) | 3.09 (2.63 to 4.59) | 12.13 (9.66 to 17.25) |
| expenses_worst | 6.73 (6.60 to 6.82) | 15.89 (13.41 to 16.65) | 3.37 (2.93 to 4.47) | 11.34 (8.88 to 12.81) |
| suppliers_list | 155.49 (152.98 to 156.05) | 264.45 (208.31 to 281.14) | 3.51 (3.21 to 4.27) | 12.13 (9.88 to 14.31) |
dropped iterations: 0/0/0

### EXPLAIN (ANALYZE, BUFFERS): the most expensive queries

Execution time of the queries the server issues, with indexes and without the extra indexes, run 1 (run 2 is within 10% in each case):

| query | with indexes | without extra indexes |
|---|---|---|
| supplier list, search `q` | 221.5 ms | 226.2 ms |
| supplier list, first page | 180.9 ms | 180.1 ms |
| supplier list, cursor page | 140.4 ms | 145.0 ms |
| expense page (first / worst case, last page) | 0.10 / 0.05 ms | 22.6 / 24.8 ms |
| expense by public id | 0.02 ms | 24.6 ms |
| supplier detail (top supplier, 5,177 cells) | 3.1 ms | 11.9 ms |
| categories | 0.8 ms | 0.8 ms |
| deputy row, months, categories, publication, meta | each under 0.3 ms | each under 0.3 ms |

The three most expensive with indexes are all `/v1/suppliers` list variants:

1. **Search `q`**: `Gather Merge` over a `Parallel Seq Scan` of `supplier_cells` (2 workers, 158 ms in the scan: `strpos(translate(lower(label), ...))` runs on every row), sort, `GroupAggregate` down to 15,009 labels, top-N sort for the 51 rows returned. 4,647 buffers hit.
2. **First page**: `Seq Scan` of 123,504 rows (10 ms), then a `Sort` by `label, supplier_key, deputy_id` using an `external merge` on disk (14.5 MB of temp files, 1,819 blocks read and 1,823 written), `GroupAggregate` to 21,677 rows, top-N sort of 101 rows. 4,519 buffers hit. The sort dominates.
3. **Cursor page**: the same plan as the first page; the `label > cursor` condition is applied after the aggregation, so it aggregates everything again (140 ms).

None of them can use an index: the aggregation covers the whole table and the cursor and the search filter are applied after it. They are about as slow without the extra indexes, which confirms the indexes are irrelevant to them. Without indexes, the next most expensive are the full scans of `expenses` for an expense page and for a lookup by `public_id` (22 to 25 ms each, parallel seq scan reading 37,057 buffers).

Complete plans: `results/run1/explain-with-indexes.txt` and `results/run1/explain-without-extra-indexes.txt` (and the same for run 2).

### Files

`run.ps1` (everything), `tables.ps1` (tables), `mix.js` (open-model mix), `etag.js` (304 vs 200), `fixture.sql` (ids from the active publication), `explain.sql`, `static/main.go` (baseline server), `results/run1` and `results/run2` (k6 summaries as small JSON, one `*.proc.json` per run with exit code and CPU, `env.json`, `tables.md`, EXPLAIN output).
