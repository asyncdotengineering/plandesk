# Sprint 6 — Plan (final)

**Sprint name:** Polish + 1.0
**Sprint goal:** Every §9 fail-to-pass test and validation command is green, the v1 measurable-outcome metrics (cold start <5 s, MCP list/inspect <2 s p95, SSE <500 ms, lossless export) are measured and met, and the repo ships a 1.0 tag with full setup docs.
**Sprint window:** 2026-06-08 → (1w)
**Author:** Opus 4.8 (1M), 2026-06-08

## 1. Stories

### `S6-01` — Validation suite (§9)
**Description:** Make the RFC §9 named assertions discoverable + green, and add `scripts/validate.sh` running the §9.3 commands against a live `plandesk serve`. Name tests to match the RFC ids (`test:canvas_roundtrip`, `test:doc_link`, `test:sse_task_update`, `test:mcp_update_task`, `test:export_import`, `test:factory_adapter_smoke`). Explicit regression tests: migration up/down on empty+seeded DB; token revoke→401.
**Acceptance:** `pnpm test` green incl. all named assertions; `scripts/validate.sh` runs `cmd:api_health`, `cmd:mcp_list_tools`, `cmd:plandesk_serve` green; a `pnpm validate` (or documented) entrypoint.

### `S6-02` — Metrics gate (§1)
**Description:** `scripts/metrics.mjs` measuring: cold start (process start → first project create), MCP `list_projects`+`get_project` p95 on localhost, SSE broadcast latency (PATCH→event), export/import losslessness. Record real numbers in `METRICS.md`.
**Acceptance:** measured numbers recorded; meet targets (cold start <5 s, MCP <2 s p95, SSE <500 ms, lossless). If a target is missed → optimize honestly or RFC amendment; never game.

### `S6-03` — Docs + release 1.0
**Description:** Top-level `README.md` (quickstart, Docker self-host, MCP setup following the standard flow, `plandesk connect`, dogfood demo), `docs/mcp-setup.md`, `docs/skills/plandesk-mcp.md`, `CHANGELOG.md`. §10 threat-model checklist verified. Fold RFC housekeeping (C17 ref, §7.4 pointer, §4.4 canvas_layout note) in `../plandesk-rfc/`. Tag `v1.0.0`.
**Acceptance:** a new developer can follow README clone→serve→connect agent→run dogfood; threat-model checklist ticked; `v1.0.0` tagged on green CI.

## 2. Universal DoD (per story)
- [ ] build+test+lint green. No stubs/`@ts-ignore`/scratch files. Atomic `[S6-NN]` commit.
- [ ] Metrics measured (not asserted); docs let a fresh dev succeed end-to-end. Reap test servers each round.

## 3. Test plan
| Story | Test |
|-------|------|
| S6-01 | named §9 assertions green; validate.sh green; regression (migrate up/down, revoke→401) |
| S6-02 | metrics script runs; METRICS.md numbers meet targets |
| S6-03 | docs walkthrough sanity; v1.0.0 tag on green |

## 4. Demo
Cold-path: clone → `pnpm install && pnpm build` → `plandesk init && serve` → open UI → `plandesk connect` an agent repo → agent inspects the dogfood project over MCP + updates a task → board/canvas reflect it. Plus the metrics table.

## 5. Risks
| Risk | Detection | Mitigation |
|------|-----------|------------|
| Metric miss (cold start / MCP p95 / SSE) | S6-02 measurement | optimize honestly (lazy init, prebuilt assets); structural miss → RFC amendment, not gaming |
| Named assertions not discoverable | grep for test ids | rename test descriptions to the RFC ids; validate.sh |
| README drift from reality | follow it literally | manager does the cold-path walkthrough |

## 6. Open questions
- `v1.0.0` tag is local (no remote). Tag on `main` after S6-03 green. Program completes at `[S6-close]` + tag.
