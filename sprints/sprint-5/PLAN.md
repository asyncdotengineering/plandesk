# Sprint 5 — Plan

**Sprint name:** Distribution + integration + dogfood
**Sprint goal:** `plandesk connect` wires a real repo (`.plandesk/` + commit-safe `.mcp.json` + idempotent CLAUDE.md/AGENTS.md include), `docker compose up` serves the UI on :3847, the Factory Desk MCP-client adapter lists projects, and the dogfood fixture imports clean.
**Sprint window:** 2026-06-08 → (1w)
**Author:** Opus 4.8 (1M), 2026-06-08

## 1. Stories

### `S5-01` — `plandesk connect` + `.plandesk/` + skill (C17 + RFC §4.7)
**Description:** Implement the repo-connection command exactly per **RFC §4.7**: `connect`/`disconnect`/`doctor` (doctor exists — extend) subcommands; write `.plandesk/{config.json (committed), skill.md (committed from §4.7.5), token (gitignored)}`; project-scoped `.mcp.json` with `${PLANDESK_MCP_TOKEN}`; idempotent sentinel-block include in CLAUDE.md/AGENTS.md; `.codex/commands/plandesk.md`; append `.plandesk/token` to `.gitignore`. `connect --print` dry-run. Project resolution: read `.plandesk/config.json` first.
**Acceptance:** `connect --print` shows exact files; real run in a temp repo writes all artifacts; **re-run is idempotent** (no dup blocks); token never in a committed file; `disconnect` removes cleanly; `doctor` validates the binding.

### `S5-02` — Docker self-host (C18)
**Description:** `Dockerfile` (build web + bundle api/cli) + `docker-compose.yml`. Single small container; loopback default; `0.0.0.0` only with `PLANDESK_AUTH_PASSWORD`; volume-persisted `workspace.db`; non-root. Honor the global Docker/Fly platform rules (smallest image, one container).
**Acceptance:** `docker compose up` serves UI + API on :3847; volume persists DB across restarts; container runs as non-root. (Build verified; runtime smoke if Docker available, else documented.)

### `S5-03` — Factory Desk adapter (C19)
**Description:** `packages/plandesk-mcp-client/` consumer SDK: official MCP SDK client + Streamable HTTP, reads `PLANDESK_URL`/`PLANDESK_MCP_TOKEN`, exposes `listProjects()` (+ minimal read). No canvas state duplicated. REST/MCP-only coupling (REQ-12).
**Acceptance:** `test:factory_adapter_smoke` — client with a test token lists ≥1 project over MCP against a running server.

### `S5-04` — Dogfood project (C20)
**Description:** `examples/checkout-revamp.json` (`plandesk-export-v1`) mirroring the case-study shape (tasks + labeled edges + linked docs). Import + MCP-inspect verifies; becomes the README demo project.
**Acceptance:** import fixture → project graph matches; MCP `get_project` returns the case-study shape.

## 2. Universal DoD (per story)
- [ ] build+test+lint green; happy+failure tests.
- [ ] No secrets in committed files (S5-01); idempotent connect.
- [ ] Platform rules honored (S5-02: smallest image, single container, non-root).
- [ ] No stubs/`@ts-ignore`/scratch files; atomic `[S5-NN]` commit. Reap test servers/agents each round.

## 3. Test plan
| Story | Test |
|-------|------|
| S5-01 | connect writes artifacts (temp repo); idempotent re-run; token not committed; disconnect; doctor |
| S5-02 | Dockerfile builds; compose config valid; (runtime smoke if Docker present) |
| S5-03 | factory_adapter_smoke lists ≥1 project over MCP |
| S5-04 | import dogfood → counts/shape match; MCP get_project |

## 4. Demo
`plandesk connect` in a throwaway repo → show `.plandesk/`, `.mcp.json` (env-var, no secret), CLAUDE.md sentinel block, re-run idempotent → docker compose up serves UI → adapter lists projects → import dogfood fixture.

## 5. Risks
| Risk | Detection | Mitigation |
|------|-----------|------------|
| Token leak in committed `.mcp.json`/config | grep committed files for `plandesk_mcp_` | env-var expansion only; `.gitignore` token; assertion test |
| Idempotency bug dups CLAUDE.md block | re-run connect twice, diff | sentinel markers + replace-between |
| Docker image bloated / multi-container | image size / compose services >1 | multi-stage build; single service; platform rules |
| Adapter duplicates canvas state | adapter writes canvas locally | read-only list over MCP; REQ-12 |

## 6. Open questions
- Docker runtime smoke depends on Docker being installed in this env; if absent, verify the Dockerfile/compose build + config statically and document the runtime step. Do NOT skip the artifacts.
- Fold RFC housekeeping (C17 ref, §7.4 stub pointer, §4.4 canvas_layout note) during this sprint.
