# Sprint 4 → Sprint 5 Handoff

**Read me first.** One page to start Sprint 5 (Distribution + integration + dogfood).

## State of the world

- `main`, all green: build + lint + 182 tests. Backend + **UI feature-complete**; whole product usable in a browser via `plandesk serve` (same-origin SPA + API + MCP).
- graph-native loop works: external Claude/Codex over MCP read/write the plan; canvas/board/agent-panel update live via SSE.

## What Sprint 5 builds (WBS § Sprint 5) — this is the RFC §4.7 work this program added

- **S5-01** `plandesk connect` + `.plandesk/` + skill (C17 + §4.7): `connect`/`disconnect`/`doctor` CLI subcommands; write `.plandesk/{config.json (committed), skill.md (committed), token (gitignored)}`; project-scoped `.mcp.json` with `${PLANDESK_MCP_TOKEN}` env expansion; idempotent sentinel-block include in CLAUDE.md/AGENTS.md; `.codex/commands/plandesk.md`. Ship `.plandesk/skill.md` from **RFC §4.7.5**. Resolve project: read `.plandesk/config.json` first (deterministic), heuristic fallback.
- **S5-02** Docker self-host (C18): `Dockerfile` + `docker-compose.yml` — single small container, loopback default, `0.0.0.0` only with `PLANDESK_AUTH_PASSWORD`, volume-persisted `workspace.db`, non-root. (Honors the global Fly/Docker platform rules: smallest image, one container.)
- **S5-03** Factory Desk adapter (C19): `packages/plandesk-mcp-client/` consumer SDK reading `PLANDESK_URL`/`PLANDESK_MCP_TOKEN`, `list_projects`; no canvas state duplicated. `test:factory_adapter_smoke`.
- **S5-04** Dogfood (C20): `examples/checkout-revamp.json` (`plandesk-export-v1`); import + MCP-inspect verifies; becomes the README demo project.

## Critical conventions to carry

- **`plandesk connect` design is fully specified in RFC §4.7** (02-requirements-interfaces.md §4.7.1–4.7.5). Follow it exactly: committed `config.json` (no secrets) + `skill.md`; token via env-var in `.mcp.json` (never committed); idempotent sentinel markers `<!-- plandesk:start --><!-- plandesk:end -->`; `connect --print` dry-run; re-run is idempotent.
- **No secrets in committed files.** `connect` appends `.plandesk/token` to `.gitignore`.
- Reuse the existing CLI arg/dispatch pattern (`args.ts`/`cli.ts`/per-command modules) and the `@plandesk/db` token repo (`createToken`).
- `plandesk-mcp-client` uses the official MCP SDK client + Streamable HTTP transport (mirror the server transport choice).
- Docker: build web + bundle api/cli; serve on 3847; **follow the global platform rules** (smallest image, single container, non-root).
- ESM/NodeNext, strict TS 6.0.3, no stubs/`@ts-ignore`, atomic `[S5-NN]` commits, no scratch files. **Reap test servers + agent stragglers each round.**

## Also fold during Sprint 5 (RFC housekeeping, per WARMDOWNs)

- RFC §8 C17 → reference `plandesk connect` + `.plandesk/` + `packages/plandesk-cli/src/connect.ts`.
- RFC §7.4 skill stub → superseded by §4.7.5 (add a pointer).
- RFC §4.4 → note the additive `projects.canvas_layout` column.

## Load-bearing reading for Sprint 5

1. `sprints/sprint-4/WARMDOWN.md` + this handoff.
2. `sprints/WBS.md` § Sprint 5 + § 1.2 DoD.
3. `../plandesk-rfc/02-requirements-interfaces.md` **§4.7 (full — connect/.plandesk/skill)**, §4.6 (Factory adapter), §3 REQ-6/11/12.
4. `../plandesk-rfc/05-security-rollback-open-qs.md` §10 (token handling, no secrets committed).
5. `packages/plandesk-cli/src/*` (CLI pattern), `packages/plandesk-db/src/repositories/tokens.ts`.
6. Global platform rules (Docker/Fly) in the user's CLAUDE.md.

## Starting state for Sprint 5

Clean `main`, Sprint 4 closed. Next: write `sprints/sprint-5/PLAN.md`, then brief S5-01 → `/delegate --mode impl --to cursor`. RFC §4.7 is the spec for S5-01 — follow it precisely.
