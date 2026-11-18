### Three runs per step (run1): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.27 (3.24 to 3.39) | 10.37 (9.12 to 13.25) | 19.53 (17.64 to 21.63) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 1,391.1 | 0.30 (0.29 to 0.34) | 0.40 (0.38 to 0.41) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 7.78 (6.86 to 7.99) | 86.34 (65.79 to 89.05) | 304.98 (270.69 to 317.24) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.18 (0.10 to 0.18) | 0.10 (0.08 to 0.11) |
| (b) API, with indexes | 100/s | 5.84 (5.73 to 5.87) | 27.95 (27.55 to 30.19) | 272.32 (249.83 to 276.59) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.15 (0.14 to 0.17) | 0.09 (0.08 to 0.10) |

### p95 by endpoint at the reference rate, median of 3 runs, ms

| step | profile | expenses | expenses_worst | suppliers_list | suppliers_search | supplier_detail | meta |
|---|---|---|---|---|---|---|---|
| (0) static files | 10.37 | 3.71 | 8.49 | 19.53 | - | 17.20 | 3.03 |
| (a) API, full-scan cost (no extra indexes) | 10.29 | 72.14 | 68.16 | 228.63 | 536.02 | 28.40 | 6.65 |
| (b) API, with indexes | 12.58 | 14.44 | 14.50 | 200.71 | 401.82 | 11.83 | 10.93 |

### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s

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

### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms

| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |
|---|---|---|---|---|
| profile | 6.21 (6.19 to 6.26) | 12.24 (10.07 to 12.52) | 3.84 (3.78 to 5.25) | 13.46 (10.78 to 18.09) |
| expenses_worst | 6.88 (6.87 to 6.91) | 17.89 (12.22 to 20.53) | 3.45 (2.97 to 4.67) | 13.19 (11.23 to 15.66) |
| suppliers_list | 154.59 (154.57 to 164.82) | 240.90 (234.86 to 298.54) | 3.26 (3.19 to 5.54) | 13.08 (10.67 to 14.39) |
dropped iterations: 0/0/0
