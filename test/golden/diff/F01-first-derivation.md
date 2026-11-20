# Thresholds diff

## pw-perf-thresholds.api.json (created)

3 added · 2 skipped

| | Key | Before | After |
|---|---|---|---|
| + | `GET /api/search?q` |  | t 500 · median 196 · p95 854 · p99 940 · apdex 0.900 · wilson 0.150 · errors 0.050 |
| + | `GET /api/tickets` |  | t 500 · median 280 · p95 376 · p99 510 · apdex 0.945 · wilson 0.035 · errors 0.050 |
| + | `POST /api/orders` |  | t 868 · median 896 · p95 1820 · p99 2002 · apdex 0.900 · wilson 0.150 · errors 0.075 |

## pw-perf-thresholds.custom.json (created)

1 added · 1 skipped

| | Key | Before | After |
|---|---|---|---|
| + | `checkout › pay` |  | t 3100 · median 4320 · p95 5580 · p99 6138 · apdex 0.900 · wilson 0.100 · errors 0.050 |
