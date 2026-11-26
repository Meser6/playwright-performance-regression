# Thresholds diff

## pw-perf-thresholds.api.json (updated)

1 added · 1 removed · 2 loosened · 2 tightened · 1 mixed · 2 unchanged (2 within hysteresis, 2 +new fields) · 3 locked (2 incomplete entries) · 1 unseen · 2 skipped

| | Key | Before | After |
|---|---|---|---|
| ↑ | `GET /api/loosened` | p99 400 | p99 492 |
| ↑! | `GET /api/loosened-much` | median 120 · p95 200 · p99 300 | median 220 · p95 364 · p99 492 |
| ± | `GET /api/mixed` | median 150 · errors 0.200 | median 220 · errors 0.050 |
| ↓ | `GET /api/muted-expired` | median 400 | median 220 |
| + | `GET /api/new` |  | apdex T 500 ms · median 220 · p95 364 · p99 492 · apdex 0.947 · wilson 0.030 · errors 0.050 · nonSuccess 0.050 |
| ↓ | `GET /api/tightened` | p95 600 · p99 800 | p95 364 · p99 492 |
| - | `GET /api/unseen` | apdex T 500 ms · median 220 · p95 364 · p99 492 · apdex 0.947 · wilson 0.030 · errors 0.050 |  |

Skipped (no entry derived):

- `GET /api/new-small-n`: 2 successful samples, 5 needed
- `GET /api/small-n`: 3 successful samples, 5 needed

- `GET /api/muted-expired` muted (expired 2026-11-15)

Entries marked with ! loosened a time limit by a large step; check that they do not accept a regression.
