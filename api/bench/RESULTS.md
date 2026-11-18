226,510 records, one laptop, loopback, k6 and server and Postgres on the same machine

# Clareia public API: benchmark (Phase 4, after the `suppliers` table)

Everything here is a measurement of Go + pgx + JSON serialization over loopback. It does not measure disk (all data is cached in memory), network, TLS, a proxy or real users. The traffic mix is an assumption, not observed traffic: the site is not launched. Rate limiting is off.

There are two sets of measurements of the same code base. The first benchmark (`results/before-suppliers-table/`, its text in `results/before-suppliers-table/RESULTS-before.md`) found that the supplier list re-aggregated 123,504 rows on every request and capped the API at 168 req/s. The loader now builds a per-publication `suppliers` table (commit `1ba94df`) and `/v1/suppliers` reads it. The rest of this file is the rerun with that table: `results/run1` and `results/run2`.

## Status of the plan's criteria

- **The plan's criterion "a second full run within ±10% on p95" was NOT met**: it is met only by step (a). Static files (0) and the real API setup (b) missed it. Whether to waive it is João's decision; I did not change the criterion or rerun until it passed.
- **The supplier list is below the 50 ms line; the supplier search is not.** A `q` search with fewer than 51 results scans all 21,677 labels (p50 73 to 88 ms in step (b)). This is a known limitation; whether to fix it (for example by storing a normalized label column) is João's decision.

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
- **EXPLAIN (ANALYZE, BUFFERS)** of every query the server issues (`explain.sql`), second execution. Run 1's EXPLAIN used the earlier query list (the aggregation queries only); run 2's includes the new `suppliers` queries next to the old ones, labelled.
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

## Tables per run, after the `suppliers` table (generated by `tables.ps1` from the stored k6 summaries)

### Run 1

#### Runs per step at the reference rate (run1): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.14 (1.53 to 3.29) | 12.03 (10.56 to 16.20) | 21.51 (20.40 to 24.89) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 1,401.7 | 0.26 (0.21 to 0.29) | 0.36 (0.30 to 0.41) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 6.74 (6.67 to 6.84) | 36.71 (36.29 to 36.78) | 94.71 (94.13 to 95.08) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 20.1 | 0.16 (0.15 to 0.16) | 0.09 (0.08 to 0.09) |
| (b) API, with indexes | 100/s | 5.68 (5.59 to 7.12) | 21.91 (21.69 to 24.43) | 85.48 (84.88 to 88.32) | 100.0 (100.0 to 100.0) | 0/0/0/0/0 | 0.000/0.000/0.000/0.000/0.000% | 20.1 | 0.16 (0.15 to 0.17) | 0.09 (0.08 to 0.09) |

#### p95 by endpoint at the reference rate, median of the runs of each step, ms

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

#### p95 by endpoint at the reference rate, median of the runs of each step, ms

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

Run 2 (`results/run2/explain-with-indexes.txt`), with indexes: the list queries `/v1/suppliers` runs now are an `Index Scan using suppliers_pkey` with `LIMIT` (first page 0.03 ms, cursor page 0.08 ms; single measurements). A search stops early only when it finds 51 labels: the term `ltda` does (0.3 ms, the best case); any term with fewer than 51 results filters all 21,677 rows with `strpos(translate(lower(label), ...))`, which is why the HTTP p50 of `suppliers_search` is 73 to 88 ms. The old aggregation queries are kept in `explain.sql` for comparison and measured 148 to 191 ms in run 2 and 188 to 255 ms in run 1; their plans before the table (a `Sort` through 14.5 MB of temp files and a `GroupAggregate` over 123,504 rows) are described in `results/before-suppliers-table/RESULTS-before.md`. All other queries are unchanged: deputy, months and categories under 0.3 ms; expense page 0.04 to 0.1 ms with indexes against 22 to 25 ms without; supplier detail about 3 ms with indexes against 12 ms without.

Run 1 and run 2 EXPLAIN files are in `results/run1/` and `results/run2/`.

## Files

`run.ps1`, `tables.ps1`, `mix.js`, `etag.js`, `fixture.sql`, `explain.sql`, `static/main.go`; `results/run1`, `results/run2` (after the table); `results/before-suppliers-table/` (the first benchmark: `run1`, `run2` and `RESULTS-before.md`, its text as written then). The JSON files are the reduced summaries written by k6's `handleSummary` (percentiles, rates, per-endpoint latency), not the full k6 output.
