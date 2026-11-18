### Three runs per step (run2): median (min to max), ms

| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |
|---|---|---|---|---|---|---|---|---|---|---|
| (0) static files | 100/s | 3.28 (3.26 to 3.40) | 12.44 (11.56 to 15.95) | 22.28 (20.89 to 24.10) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 1,391.2 | 0.28 (0.27 to 0.35) | 0.38 (0.37 to 0.45) |
| (a) API, full-scan cost (no extra indexes) | 100/s | 8.02 (7.77 to 8.23) | 97.81 (90.63 to 98.14) | 340.09 (327.88 to 346.38) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.19 (0.16 to 0.19) | 0.10 (0.10 to 0.11) |
| (b) API, with indexes | 100/s | 5.75 (5.69 to 5.84) | 30.57 (27.88 to 34.49) | 278.09 (275.11 to 282.49) | 100.0 (100.0 to 100.0) | 0/0/0 | 0.000/0.000/0.000% | 20.5 | 0.16 (0.15 to 0.16) | 0.10 (0.09 to 0.10) |

### p95 by endpoint at the reference rate, median of 3 runs, ms

| step | profile | expenses | expenses_worst | suppliers_list | suppliers_search | supplier_detail | meta |
|---|---|---|---|---|---|---|---|
| (0) static files | 12.40 | 3.74 | 10.93 | 21.56 | - | 22.22 | 2.77 |
| (a) API, full-scan cost (no extra indexes) | 9.98 | 87.13 | 74.53 | 266.06 | 789.93 | 29.64 | 6.82 |
| (b) API, with indexes | 12.69 | 15.28 | 11.17 | 173.08 | 403.81 | 9.19 | 10.10 |

### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s

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

### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms

| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |
|---|---|---|---|---|
| profile | 6.16 (6.03 to 6.25) | 10.05 (9.00 to 11.78) | 3.09 (2.63 to 4.59) | 12.13 (9.66 to 17.25) |
| expenses_worst | 6.73 (6.60 to 6.82) | 15.89 (13.41 to 16.65) | 3.37 (2.93 to 4.47) | 11.34 (8.88 to 12.81) |
| suppliers_list | 155.49 (152.98 to 156.05) | 264.45 (208.31 to 281.14) | 3.51 (3.21 to 4.27) | 12.13 (9.88 to 14.31) |
dropped iterations: 0/0/0
