# Sprint 0 — Plan

**Sprint name:** Foundations
**Sprint goal (one sentence):** `pnpm build` is green and `plandesk serve` binds `127.0.0.1:3847` serving `GET /api/v1/health → {ok:true}` against a migrated SQLite workspace with all RFC §4.4 tables.
**Sprint window:** 2026-06-07 → (1w)
**Author (main session):** Opus 4.8 (1M), 2026-06-07

---

## 1. Stories

### `S0-01` — Monorepo scaffold (C1)

**Description:** Stand up the `asyncdot/plandesk` monorepo exactly as RFC §5.1: pnpm workspace + Turborepo, the app `apps/plandesk-web` and packages `packages/{plandesk-api,plandesk-db,plandesk-mcp,plandesk-cli,plandesk-mcp-client}`, shared strict TypeScript config, ESLint + Prettier, Vitest, and a GitHub Actions CI workflow running install→build→test→lint. Latest stable versions of every dependency. No application logic yet — but every package must compile and the workspace must build green. This is the foundation other stories build on, so it must be real (no placeholder packages that don't compile).

**Acceptance criteria** (numbered, in priority order):
1. `pnpm install` succeeds; `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.
2. `pnpm build` is green across all packages (Turbo pipeline `build`).
3. `pnpm test` runs Vitest green (at least one real smoke test per package proving the test runner is wired).
4. `pnpm lint` (ESLint, flat config) and `pnpm format --check` (Prettier) pass.
5. Root `tsconfig.base.json` with `strict: true`; each package extends it. No `any`-loose escape hatches.
6. `.gitignore` covers `node_modules`, `dist`, `*.db`, `.plandesk/token`, coverage, `.turbo`, `.handoff/result-*.txt`.
7. `.github/workflows/ci.yml` runs install→build→test→lint on Node 22 (matrix may add Node 20).
8. Each package has a `package.json` with correct name (`@plandesk/api`, `@plandesk/db`, `@plandesk/mcp`, `@plandesk/cli`, `@plandesk/mcp-client`, `plandesk-web`), `build`, `test`, `lint` scripts, and a minimal compiling `src/index.ts`.

**Files expected to be created or modified:**
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`
- `.github/workflows/ci.yml`
- `eslint.config.js`, `.prettierrc`
- `apps/plandesk-web/{package.json,tsconfig.json,index.html,vite.config.ts,src/main.tsx,src/App.tsx}`
- `packages/plandesk-api/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
- `packages/plandesk-db/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
- `packages/plandesk-mcp/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
- `packages/plandesk-cli/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`
- `packages/plandesk-mcp-client/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`

**Test fixtures the worker will add:** one trivial behavioral smoke test per package (e.g. an exported `version()` returns the package version).

**Demo artifact:** asciinema/text transcript at `sprints/sprint-0/artifacts/s0-01-build.txt` showing `pnpm install && pnpm build && pnpm test && pnpm lint` green.

### `S0-02` — DB schema + migrations (C2)

**Description:** Implement `@plandesk/db` with Drizzle ORM over better-sqlite3: all eight RFC §4.4 tables (projects, tasks, edges, documents, agent_runs, agent_run_events, mcp_tokens; `document_comments` defined but commented/flagged v1.1), a migration runner, a typed repository layer, and a seed fixture. SQLite at `~/.plandesk/workspace.db` (path injectable for tests).

**Acceptance criteria:**
1. Drizzle schema defines all §4.4 tables with the exact columns named in the RFC; status enum `scope|todo|in_progress|done|backlog` enforced.
2. `drizzle-kit` migrations generate + apply cleanly on an empty DB; tables verified present.
3. A `migrate(db)` function runs migrations programmatically (used by CLI `init`).
4. Repository functions for projects + tasks (create/get/list/update) with behavioral tests (happy + failure path each).
5. A `seed(db)` inserts a fixture project; idempotent.
6. Tests run against an in-memory / temp-file SQLite, not the user's real DB.

**Files:** `packages/plandesk-db/src/{schema.ts,migrate.ts,client.ts,repositories/*.ts,seed.ts,*.test.ts}`, `packages/plandesk-db/drizzle.config.ts`, generated `packages/plandesk-db/drizzle/*`.

**Demo artifact:** `sprints/sprint-0/artifacts/s0-02-migrate.txt` — migration output + table list.

### `S0-03` — API + CLI skeleton (C3/C10 subset)

**Description:** Minimal Hono API (`@plandesk/api`) exposing `GET /api/v1/health → {ok:true}` plus a static-asset serving hook, served by `@hono/node-server`. `@plandesk/cli` exposes `plandesk init` (creates/migrates `~/.plandesk/workspace.db`, `--data-dir` override) and `plandesk serve [--port 3847] [--data-dir]` binding **127.0.0.1** only, port-in-use → exit 1 with message.

**Acceptance criteria:**
1. `GET /api/v1/health` returns `{"ok":true}` (200, JSON).
2. `plandesk init --data-dir <dir>` creates a migrated `workspace.db` in that dir.
3. `plandesk serve --data-dir <dir> --port <p>` boots and binds `127.0.0.1` only (not 0.0.0.0).
4. Port already in use → process exits 1 with a clear message (`cmd:plandesk_serve`).
5. `cmd:api_health` proof: `curl -sf http://127.0.0.1:3847/api/v1/health | jq '.ok'` → `true`.
6. Behavioral tests for the health route and the CLI arg parsing.

**Files:** `packages/plandesk-api/src/{server.ts,routes/health.ts,static.ts,*.test.ts}`, `packages/plandesk-cli/src/{cli.ts,serve.ts,init.ts,*.test.ts}`, `packages/plandesk-cli/bin/plandesk`.

**Demo artifact:** `sprints/sprint-0/artifacts/s0-03-serve.txt` — serve + curl health transcript.

---

## 2. Universal DoD checklist (per story)

- [ ] `pnpm install && pnpm build && pnpm test && pnpm lint` green locally (list runtimes tested).
- [ ] Behavioral coverage: every public surface tested with at least one happy-path and one failure-path test.
- [ ] Proof JSON written (`.handoff/proof-s0-NN.json`); manager proceed = **PROCEED**.
- [ ] Demo artifact at `sprints/sprint-0/artifacts/`.
- [ ] No `--no-verify`, no `@ts-ignore`, no `try/catch`-swallow, no stub/TODO in shipped paths.
- [ ] Atomic commit `[S0-NN] <title>` on `main`.

---

## 3. Test plan

| Story | Layer | Test type | Fixtures |
|-------|-------|-----------|----------|
| S0-01 | unit | per-package smoke (version) | none |
| S0-02 | unit | repository happy/failure | temp SQLite |
| S0-02 | integration | migrate up on empty DB | temp SQLite |
| S0-03 | integration | health route returns ok | Hono test client |
| S0-03 | unit | CLI arg parse + bind host | temp dir |

What we will NOT test this sprint, and why it's safe:
- Canvas/docs/MCP behavior — not built yet (Sprints 1–2).
- UI rendering beyond build — Sprint 3.

---

## 4. Demo plan

**Demo:** A single terminal transcript: `pnpm build` green → `plandesk init --data-dir ./tmp` → `plandesk serve --data-dir ./tmp &` → `curl /api/v1/health` → `{"ok":true}` → drizzle table list showing all §4.4 tables. Captured at warm-down from the three per-story artifacts.

---

## 5. Risks specific to this sprint

| Risk | Detection signal | Mitigation |
|------|------------------|------------|
| Latest-version peer-dep drift (React 19 / Vite / Drizzle / Hono) | `pnpm build` peer warnings/failures | Pin resolved latest in lockfile; record versions in WARMDOWN. |
| better-sqlite3 native build on arm64 macOS | install/build error | Confirm prebuilt binary; fallback to `node:sqlite` only via explicit RFC amendment. |
| Turbo pipeline misconfig hides a non-building package | a package skipped in `pnpm build` | Each package has a real `build` script + a compiling `src/index.ts`. |

---

## 6. Open questions

- None blocking. `document_comments` is defined-but-deferred (v1.1) per RFC §4.4 — include the table definition commented or behind a clearly-marked v1.1 note, do not wire it.
