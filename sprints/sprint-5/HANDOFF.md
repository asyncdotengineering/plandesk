# Sprint 5 → Sprint 6 Handoff

**Read me first.** One page to start Sprint 6 (Polish + 1.0 — the final sprint).

## State of the world

- `main`, all green: build + lint + full suite (≈190 tests). Product is **feature-complete + distributable**: backend (REST+SSE+MCP+CLI), full UI, `plandesk connect`, Docker self-host, Factory adapter, dogfood fixture.
- A developer can already: `plandesk serve` (or `docker compose up`) → use the whole graph-native app in a browser → connect Claude/Codex via `plandesk connect` → drive the plan over MCP with live SSE updates.

## What Sprint 6 builds (WBS § Sprint 6) — discharge the RFC's validation + metrics + ship 1.0

- **S6-01** Full validation suite (§9): wire every fail-to-pass test name + §9.3 validation commands into `pnpm test` + a `scripts/validate.sh`; regression tests (migration up/down; token revoke→401 — already covered, assert explicitly). Ensure the named assertions (`test:canvas_roundtrip`, `test:doc_link`, `test:sse_task_update`, `test:mcp_update_task`, `test:export_import`, `test:factory_adapter_smoke`, `cmd:api_health`, `cmd:mcp_list_tools`, `cmd:plandesk_serve`) are all green and discoverable.
- **S6-02** Metrics gate (§1): a `scripts/metrics.*` that measures cold start to first project, MCP list+inspect p95 on localhost, SSE broadcast latency, export/import losslessness; record results in `METRICS.md`. Targets: cold start <5 s, MCP <2 s p95, SSE <500 ms.
- **S6-03** Docs + release: top-level `README.md` (quickstart, self-host via Docker, MCP setup following the standard flow, `plandesk connect`), `docs/mcp-setup.md`, `docs/skills/plandesk-mcp.md`, `CHANGELOG.md`; §10 threat-model checklist verified; tag `v1.0.0`. Fold the RFC housekeeping (C17 ref, §7.4 pointer, §4.4 canvas_layout note) — note: RFC lives at `../plandesk-rfc/`.

## Critical conventions to carry

- The named assertions already pass in scattered tests — S6-01 makes them **discoverable + named** (e.g. test descriptions matching the RFC ids) and adds a `scripts/validate.sh` that runs the §9.3 curl/MCP commands against a live `plandesk serve`.
- Metrics must be **measured, not asserted** — real numbers in `METRICS.md`. If a target is missed, optimize honestly or surface as an RFC amendment; do not game it.
- README must let a brand-new developer go clone → serve → connect an agent → run the dogfood project. Use `examples/checkout-revamp.json` as the demo.
- Reap test servers + agent stragglers each round. No stubs/`@ts-ignore`/scratch files. Atomic `[S6-NN]` commits. `[S6-close]` tags `v1.0.0`.

## Load-bearing reading for Sprint 6

1. `sprints/sprint-5/WARMDOWN.md` + this handoff.
2. `sprints/WBS.md` § Sprint 6 + § 1.2 DoD.
3. `../plandesk-rfc/04-tasks-validation.md` §9 (validation contract + fail-to-pass tests + §9.3 commands).
4. `../plandesk-rfc/01-problem-background.md` §1 (measurable outcomes / metrics targets).
5. `../plandesk-rfc/05-security-rollback-open-qs.md` §10 (threat-model checklist).
6. The standard MCP setup flow (for README parity).

## Starting state for Sprint 6

Clean `main`, Sprint 5 closed. Next: write `sprints/sprint-6/PLAN.md`, then brief S6-01 → `/delegate --mode impl --to cursor`. This is the last sprint — it ends with a green validation suite, measured metrics, docs, and a `v1.0.0` tag.
