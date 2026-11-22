# Thresholds diff

## pw-perf-thresholds.json (created)

3 added · 2 skipped

| | Key | Before | After |
|---|---|---|---|
| + | `GET /api/search?q` |  | apdex T 500 ms · median 196 · p95 854 · p99 940 · apdex 0.900 · wilson 0.150 · errors 0.050 |
| + | `GET /api/tickets` |  | apdex T 500 ms · median 280 · p95 376 · p99 510 · apdex 0.945 · wilson 0.035 · errors 0.050 |
| + | `POST /api/orders` |  | apdex T 868 ms · median 896 · p95 1820 · p99 2002 · apdex 0.900 · wilson 0.150 · errors 0.075 |

Skipped (no entry derived):

- `GET /api/always-failing`: no successful samples, 5 needed (12 × 500)
- `GET /api/rare`: 3 successful samples, 5 needed
