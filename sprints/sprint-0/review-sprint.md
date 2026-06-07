# Sprint 0 Review (Phase B) — Foundations

**Reviewer:** Manager (Opus 4.8), 2026-06-07
**Scope:** commits `a140d5e`, `7cfaeb8`, `cddecd0`, `4fe89d1`, `0f7589a` on `main`
**Sprint goal:** `pnpm build` green + `plandesk serve` binds `127.0.0.1:3847` serving `/api/v1/health → {ok:true}` against a migrated SQLite workspace with all RFC §4.4 tables.

## Verdict: **SOLID — shipping.** Sprint goal met and verified end-to-end.

---

## Layer 1 — What works (grounded)

- **Schema fidelity is exact.** `packages/plandesk-db/src/schema.ts` matches RFC §4.4 column-for-column across all 8 tables; `tasks.status` enum + default, `x/y` reals, self-ref `documents.parent_id` via `AnySQLiteColumn`, `mcp_tokens.token_hash`/`revoked_at`. Independently confirmed 8 tables on a fresh migrate, idempotent on re-run.
- **Loopback security default is real, not claimed.** `lsof` confirms `serve` binds `127.0.0.1:3847`; LAN-IP probe refused (REQ-6). Not just a config string — observed behavior.
- **Clean toolchain.** Strict TS 6.0.3 unified repo-wide, NodeNext ESM with `.js` imports, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noEmitOnError`. No `@ts-ignore`/`any`-escape in package source (whole-repo grep clean; only `routeTree.gen.ts` carries the standard generated-file header).
- **Testable design.** `serve.ts` injects an `exit` fn; `createDb(path)` parametrizes the DB path so tests never touch the real `~/.plandesk`. 31 behavioral tests across packages, all green.
- **Hygiene.** No `node_modules`/`dist`/`*.db`/`.turbo` leaked into any commit; `.gitignore` correct.

## Layer 2 — Blockers / majors

**None blocking.** Items found and already resolved in fix-passes:

1. ~~Bare `"latest"` version specifiers (web + db)~~ → pinned to caret-resolved (`7cfaeb8`). Reproducibility for tooling others run.
2. ~~TypeScript skew (root 5.9.3 vs web 6.0.3)~~ → unified `^6.0.3` (`7cfaeb8`).
3. ~~Stray scratch files~~ (`s0-01-implementation-notes.md`, `s0-02-{notes,scratchpad}.md`) → removed (`7cfaeb8`, `4fe89d1`); brief constraint added, held for S0-03.

Minor (non-blocking, carried as notes, not debt):
- Timestamps stored as `timestamp_ms` integers with a julianday SQL default — fine; just document the convention so API/MCP serialization is consistent (ISO at the edges).
- `routeTree.gen.ts` is committed (TanStack convention) rather than gitignored+generated. Acceptable; revisit in S3 if it churns.

## Layer 3 — Verdict

**SOLID — shipping.** All three stories PROCEED with independent runtime verification. Sprint goal demonstrably met. No carry-over. Advance to Sprint 1 (Backend core: REST + SSE) — the service-layer SSOT discipline (WBS risk #1) is the headline constraint for S1.

## Risk-register check (WBS §5)

- *Latest-version drift* — materialized in S0, mitigated (pinned + recorded below).
- *better-sqlite3 arm64 native build* — resolved: `better-sqlite3@12.10.0` builds + runs in-memory on this arm64 macOS.
- *Turbo build-graph gap* — none; all 6 packages build, 0-cache `--force` confirmed.

## Resolved dependency versions (latest, for the record)

react 19.2.7 · react-dom 19.2.7 · vite 8.0.16 · @vitejs/plugin-react 6.0.2 · @tanstack/react-router 1.170.15 · @tanstack/router-plugin 1.168.18 · @tanstack/react-query 5.101.0 · typescript 6.0.3 · vitest 3.2.6 · turbo 2.9.16 · eslint 9.39.4 · better-sqlite3 12.10.0 · @types/better-sqlite3 7.6.13 · drizzle-orm + drizzle-kit (latest) · hono + @hono/node-server (latest) · jsdom 29.1.1 · @testing-library/react 16.3.2.
