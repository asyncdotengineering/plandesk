# Proceed Evidence — S0-02 DB schema + migrations (C2)

**Verdict:** `PROCEED`
**IC commit:** `cddecd0` `[S0-02] DB schema + migrations` (cursor)
**Manager fix:** `4fe89d1` `[S0-02-fix]` (remove 2 stray scratch files)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S0-02)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | All §4.4 tables, exact columns; `tasks.status` enum; FKs | ✅ schema matches RFC §4.4 exactly (8 tables) |
| 2 | drizzle-kit generates committed SQL; tables verified present | ✅ `drizzle/0000_*.sql` committed; 8 tables confirmed |
| 3 | Programmatic `migrate(db)` | ✅ `src/migrate.ts` via drizzle better-sqlite3 migrator |
| 4 | projects + tasks repos CRUD, happy + failure tests | ✅ `repositories/{projects,tasks}.ts` + tests |
| 5 | `seed(db)` idempotent + tested | ✅ `src/seed.ts` + `seed.test.ts` |
| 6 | Tests against in-memory/temp SQLite | ✅ no real-DB access |

## Independent verification (manager-run)

- **Schema vs RFC §4.4:** column-by-column match — `projects/tasks/edges/documents/document_comments/agent_runs/agent_run_events/mcp_tokens`. `tasks.status` enum `scope|todo|in_progress|done|backlog` default `todo`; `x/y` real default 0; self-ref `documents.parent_id`; `mcp_tokens.token_hash` + `revoked_at`.
- **FK enforcement:** `createDb` runs `PRAGMA foreign_keys = ON`.
- **Migration + idempotency:** ran `migrate()` twice on a fresh `/tmp` DB via `dist/` → no error; `SELECT name FROM sqlite_master` → exactly the 8 tables (+ `__drizzle_migrations`).
- **Gates:** `pnpm build` 6/6, `pnpm test` (db 15/15, total 12 task-runs), `pnpm lint` + Prettier clean.
- **No leak:** `git ls-files` has no node_modules/dist/*.db.

## Manager fixes applied

- Removed `s0-02-implementation-notes.md` + `s0-02-scratchpad.md` (worker scratch; scope pollution). **Action item: future briefs explicitly forbid scratch/notes files** (worker has done this twice).

## Notes for next stories

- `Db` type + `createDb(path)` + `migrate(db)` are the public db surface S0-03 CLI will consume. Raw better-sqlite3 reachable via `db.$client` (used for low-level table introspection).
- `document_comments` table is defined (v1.1) but has no repository methods — correct per brief.
- Timestamps are `timestamp_ms` integers with a julianday-based SQL default.

→ Proceed to **S0-03 (API + CLI skeleton)**.
