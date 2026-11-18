# Thresholds diff

## perf-thresholds.api.json (updated)

1 added · 2 loosened · 2 tightened · 1 mixed · 2 unchanged (2 within hysteresis) · 3 locked (2 incomplete entries) · 2 unseen · 2 skipped

| | Key | Before | After |
|---|---|---|---|
| ↑ | `GET /api/loosened` | p99 400 | p99 492 |
| ↑! | `GET /api/loosened-much` | median 120 · p95 200 · p99 300 | median 220 · p95 364 · p99 492 |
| ± | `GET /api/mixed` | median 150 · errors 0.200 | median 220 · errors 0.050 |
| ↓ | `GET /api/muted-expired` | median 400 | median 220 |
| + | `GET /api/new` |  | t 500 · median 220 · p95 364 · p99 492 · apdex 0.947 · wilson 0.030 · errors 0.050 |
| ↓ | `GET /api/tightened` | p95 600 · p99 800 | p95 364 · p99 492 |

- `GET /api/muted-expired` muted (expired 2026-11-15)

Entries marked with ! loosened a time limit by a large step; check that they do not accept a regression.

## perf-thresholds.custom.json (not written)

no entries
