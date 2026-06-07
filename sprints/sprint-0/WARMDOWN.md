# Sprint 0 Warm-down — Foundations

**Closed:** 2026-06-07 · **Status:** ✅ complete · **Build branch:** `main`

## What shipped

A buildable, testable monorepo with a real persistence layer and a working boot path.

| Story | Commit(s) | Delivers |
|-------|-----------|----------|
| S0-01 | `a140d5e` + `7cfaeb8` | pnpm/turbo monorepo, 6 packages, strict TS 6.0.3, ESLint/Prettier, Vitest, CI |
| S0-02 | `cddecd0` + `4fe89d1` | `@plandesk/db`: Drizzle schema (all 8 RFC §4.4 tables), migrations, projects+tasks repos, seed |
| S0-03 | `0f7589a` | `@plandesk/api` health route + static hook; `@plandesk/cli` `init`+`serve` (127.0.0.1) |

## What's working (verified)

- `pnpm install && pnpm build && pnpm test && pnpm lint` — all green (6 build / 31 tests / lint+Prettier).
- `plandesk init --data-dir <d>` → migrated `workspace.db` with all 8 tables.
- `plandesk serve` → `http://127.0.0.1:3847`, `GET /api/v1/health → {ok:true}`, **loopback-only** (lsof-confirmed), port-in-use → exit 1.

## What's NOT done (by design — later sprints)

- No projects/tasks/canvas/docs REST routes yet → **Sprint 1**.
- No SSE, no MCP, no export/import, no UI behavior beyond build → Sprints 1–3.
- CLI has only `init`+`serve`; `export`/`import`/`token`/`doctor` → Sprint 2.

## Decisions made

- **Build branch = `main`** (local repo, no trunk/PR model; atomic commits per round as the user asked).
- **TypeScript unified at 6.0.3** repo-wide; all deps caret-pinned to resolved latest (no bare `"latest"`).
- **Timestamps:** `timestamp_ms` integers with julianday SQL default; serialize to ISO at API/MCP edges (convention to honor in S1).
- **TanStack Router** already scaffolded in the web shell (head start for S3).

## Open issues / carry-forward

- None blocking. Worker tendency to drop scratch files → mitigated by an explicit brief constraint (now standard in all briefs).
- Convention to enforce in S1: **single service layer is the only write path** (WBS risk #1 / REQ-5 SSOT). REST routes must not touch the db client directly; SSE emitted inside the service so MCP inherits it in S2.

## RFC amendments this sprint

- None to the RFC text. (Standing open amendment: §4.7 `plandesk connect` + `.plandesk/`, lands in Sprint 5.)
