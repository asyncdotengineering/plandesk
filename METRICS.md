# Plan Desk v1 Metrics

Measured: 2026-06-07T19:39:30.360Z

Machine: darwin arm64 (192.168.1.13); Apple M1 Pro; Node v22.22.2

## Results vs RFC §1 targets

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| Cold start (serve spawn → first `POST /projects`) | < 5 s | 419.9 ms (0.42 s) | PASS |
| MCP `list_projects` + `get_project` p50 | — | 2.6 ms | — |
| MCP `list_projects` + `get_project` p95 | < 2 s | 4.9 ms | PASS |
| SSE `task_updated` latency p50 (PATCH → event) | — | 1.3 ms | — |
| SSE `task_updated` latency p95 | < 500 ms | 1.9 ms | PASS |
| Export/import lossless (counts + links) | lossless | true (tasks=3, edges=2, docs=2) | PASS |

## Measurement rig

- Script: `node scripts/metrics.mjs` (also `pnpm metrics`).
- Isolated temp data dir + ephemeral loopback port; `plandesk init` before serve.
- Cold start: fresh `plandesk serve` spawn until first successful `POST /api/v1/projects`.
- MCP: Bearer token; 50 sequential `list_projects` + `get_project` pairs via Streamable HTTP MCP.
- SSE: one `/api/v1/events` subscriber; 20 `PATCH /api/v1/tasks/:id` toggles; time to `task_updated`.
- Export/import: REST fixture (canvas nodes/edges + linked docs) → CLI export → import → re-export; compare structure without IDs.
- Server and temp dir are trapped on exit.

