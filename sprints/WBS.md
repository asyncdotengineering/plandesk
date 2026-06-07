# Work Breakdown Structure — Plan Desk

> **The build plan, sprint by sprint, end-to-end.** Spans the 5-part Plan Desk RFC (README + 01-problem-background, 02-requirements-interfaces, 03-pseudocode-blueprint, 04-tasks-validation, 05-security-rollback-open-qs) covering canvas + docs-on-nodes + tasks + board + MCP server + CLI + Factory Desk adapter. Every sprint is an end-to-end demoable slice, not a horizontal slab. Cadence and engineering practice are the same across all sprints.

---

## 1. Cadence and engineering practice

### 1.1 Cadence
- **1-week sprints.** Planning at sprint start (PLAN.md), Phase A implementation across the sprint, Phase B manager review after every story has proceed evidence, warm-down in the last hour.
- **One sprint goal**, expressed as a single sentence with a verifiable outcome.
- **2–5 stories per sprint.** Smaller is better. Each story ships independently.
- **No carry-over.** If a story slips, it goes back to the backlog, not the next sprint as-is. Rewrite the story.

### 1.2 Definition of Done (universal)
A sprint's stories are collectively Done when **all** of the following hold:

1. Every story commits atomically (`[S{N}-{nn}] {title}`) on the **active build branch** (`main` — see `sprints/STATE.md` § Build branch) behind a green CI run (`pnpm install && pnpm build && pnpm test`).
2. Unit tests written for every new exported function / class. **Coverage is not the metric**; *behavioral coverage* is — every public surface tested with at least one happy-path and one failure-path test.
3. **Passes sprint-level manager review (Phase B — after every story has proceed evidence):** manager sandwich review on full diff + briefs + proceed artifacts; blockers/majors resolved in fix pass. Optional `/delegate-review` when adversarial second opinion is explicitly needed.
4. **Public surfaces match the source RFC(s).** Diffs to the RFC require an explicit RFC amendment in the same sprint.
5. SSE event types match the RFC's documented taxonomy (`task_updated`, `canvas_updated`, `document_created`, `agent_run_*`). New events require an explicit RFC delta.
6. Docs updated: at minimum the package's README; at most an RFC delta.
7. Manual demo artifact captured per story or per sprint (curl transcript, MCP inspector output, or screenshot/recording for UI).
8. **No `--no-verify`, no type-suppression (`@ts-ignore`/`any`-casting away real types), no silent-catch shortcuts, no stub/TODO placeholders in shipped paths.** If you can't meet a check, change the design, not the gate. This is production dev tooling other developers will run — no gimmicks.

### 1.3 Branching and commits
- **Build branch:** `main` (canonical name in `sprints/STATE.md` § Build branch). This is a fresh local repo with no trunk/PR model; the user asked for atomic commits per round on the local repo, so `main` IS the build branch. All Phase A story commits and Phase B fix/closeout commits land on `main`.
- IC commits per-story atomic implementations on the build branch. Manager commits the fix pass + closeout commits on the same branch.
- Every commit message includes the story id (or `[S{N}-fix]` / `[S{N}-close]` for manager commits) and a body summarizing the diff. Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Demo artifact links/transcripts live in the commit body.

### 1.4 The review loop (proceed evidence in Phase A; manager review in Phase B)

**Phase A — IC + proceed evidence (no review workers):**

1. **IC implementation.** `cursor` (cursor-agent) fired fresh per story via `/delegate --mode impl`. Proof JSON, atomic commit. One worker = one story = one context window.
2. **Code map (when needed).** Before briefing, manager runs **`/code-understand`** for unfamiliar surfaces; links `.understanding/<slug>.md` in brief **Read These First**.
3. **Proceed evidence (manager).** After each story: diff + proof commands → `proceed-S{N}-{nn}.md`. **`PROCEED`** → next story. **`HOLD`** → re-delegate IC only.
4. Repeat until every story has **`PROCEED`**.

**Phase B — manager review (only after Phase A complete):**

5. **Manager sandwich review.** Full sprint diff + every brief + every proceed file → `review-sprint.md` (`REVIEW-r1.md` shape).
6. **Manager fix pass.** Commit `[S{N}-fix] {description}`. Optional `/delegate-review` — not default.
7. Sprint closes when WARMDOWN + HANDOFF + STATE-update commit lands.

### 1.5 Sprint warm-down (handoff to the next session)
Last hour of every sprint. Two artifacts:

1. `sprints/sprint-N/WARMDOWN.md` — what shipped, what's working, what's not, open issues, decisions made, RFC amendments this sprint.
2. `sprints/sprint-N/HANDOFF.md` — a one-page primer for the next session: read-me-first, current state of the world, sprint N+1 starting state.

The next session reads HANDOFF first, WARMDOWN if it needs depth.

---

## 2. The roadmap

| Sprint | Phase | Goal (one sentence) |
|--------|-------|---------------------|
| 0 | Foundations | `pnpm build` is green and `plandesk serve` binds `127.0.0.1:3847` serving `GET /api/v1/health → {ok:true}` against a migrated SQLite workspace with all RFC §4.4 tables. |
| 1 | Backend core (REST + SSE) | A client can CRUD projects/tasks, round-trip a canvas of nodes + labeled edges, link a document to a task, and receive an SSE `task_updated` within 500 ms of a PATCH — all through one service layer that is the single SSOT. |
| 2 | MCP + portability | Claude/Codex can connect to `/mcp/` with a hashed bearer token, list ≥8 tools, `update_task` and see it in REST GET + SSE, and a project exports→imports losslessly via the CLI. |
| 3 | Web: shell + canvas + docs | The React SPA lists projects, renders the flow canvas where a dragged node and a drawn labeled edge persist across reload, and a node click reaches its linked TipTap document in one navigation. |
| 4 | Web: board + MCP settings + agent runs | Moving a card between board columns updates the canvas node's status badge live, an MCP token can be created/copied-once/revoked from Settings, and an external agent run's progress is visible on the canvas. |
| 5 | Distribution + integration + dogfood | `plandesk connect` wires a real repo (`.plandesk/` + commit-safe `.mcp.json` + idempotent CLAUDE.md/AGENTS.md include), `docker compose up` serves the UI on :3847, the Factory Desk MCP-client adapter lists projects, and the dogfood fixture imports clean. |
| 6 | Polish + 1.0 | Every §9 fail-to-pass test and validation command is green, the v1 measurable-outcome metrics (cold start <5 s, MCP list/inspect <2 s p95, SSE <500 ms, lossless export) are measured and met, and the repo ships a 1.0 tag with full setup docs. |

The phases above map to the source RFC(s) as follows:

- **Sprint 0 (Foundations)** implements RFC §8 chunks **C1** (monorepo scaffold), **C2** (DB schema + migrations), and the health/serve skeleton subset of **C3/C10**, grounded in RFC §5.1 (monorepo layout), §4.4 (data model), §6.1 (server boot).
- **Sprint 1 (Backend core)** implements **C3** (projects+tasks), **C4** (canvas+edges), **C5** (documents), **C6** (SSE), grounded in RFC §4.2 (REST API), §3 REQ-1/2/3/4/5/9, §6.2/6.4 (pseudocode), plus the **§4.7 canvas-concurrency fix** (layout-only PUT; semantic fields via PATCH).
- **Sprint 2 (MCP + portability)** implements **C7** (MCP server + tools), **C8** (MCP write path), **C9** (export/import), **C10** (CLI complete), grounded in RFC §4.1 (CLI), §4.3 (MCP), §3 REQ-7/8/10, §6.3/6.5, §7.2.
- **Sprint 3 (Web shell + canvas + docs)** implements **C11** (web shell), **C12** (flow canvas), **C13** (document editor), grounded in RFC §4.5 (frontend, TanStack Router SPA mode), §7.3, REQ-1/2/3, A-UI-1/A-UI-2.
- **Sprint 4 (Board + settings + agent runs)** implements **C14** (board), **C15** (MCP settings UI), **C16** (agent run UI), grounded in RFC §5.2, REQ-5/8/9, A-UI-3.
- **Sprint 5 (Distribution + integration)** implements **C17 + §4.7** (`plandesk connect` + `.plandesk/` + skill), **C18** (Docker), **C19** (Factory Desk adapter), **C20** (dogfood), grounded in RFC §4.6, §4.7, §10 (security), REQ-6/11/12.
- **Sprint 6 (Polish + 1.0)** discharges RFC §9 (validation contract + fail-to-pass tests + validation commands) and §1 measurable outcomes, plus §10 threat-model verification and §11 abort-criteria checks.

---

## 3. Sprint detail

The format below repeats per sprint. Stories use the id pattern `S{N}-{nn}` (e.g. `S0-01`).

### Sprint 0 — Foundations

**Goal:** `pnpm build` is green and `plandesk serve` binds `127.0.0.1:3847` serving `GET /api/v1/health → {ok:true}` against a migrated SQLite workspace with all RFC §4.4 tables.

| Story | Description | DoD |
|-------|-------------|------|
| S0-01 | Monorepo scaffold (C1): pnpm workspace + turbo, `apps/plandesk-web` + `packages/{plandesk-api,plandesk-db,plandesk-mcp,plandesk-cli}`, shared TS config, ESLint/Prettier, Vitest, GitHub Actions CI. Latest versions of every dep. | `pnpm install && pnpm build && pnpm test && pnpm lint` all green; CI workflow file present; empty packages compile. |
| S0-02 | DB schema + migrations (C2): Drizzle + better-sqlite3, all 8 RFC §4.4 tables (projects, tasks, edges, documents, agent_runs, agent_run_events, mcp_tokens; document_comments marked v1.1), migration runner, seed fixture project. | `drizzle-kit` migrate creates all tables on empty DB; up/down both clean; seed inserts a fixture project; behavioral tests on the repository layer. |
| S0-03 | API + CLI skeleton (C3/C10 subset): Hono app with `GET /api/v1/health`, static-asset serving hook, `@hono/node-server`; `plandesk` CLI with `serve` + `init` binding `127.0.0.1:3847`, port-in-use → exit 1. | `plandesk init` creates `~/.plandesk/workspace.db` (overridable `--data-dir`); `plandesk serve` → `curl -sf .../health` returns `{"ok":true}`; binds loopback only. |

**Demo:** Terminal transcript: `pnpm build` green → `plandesk init --data-dir ./tmp` → `plandesk serve --data-dir ./tmp` → `curl /api/v1/health` returns `{"ok":true}` → drizzle table list shows all §4.4 tables.

**Dependencies:** none.

**Source RFC §:** §5.1 (monorepo), §4.4 (data model), §6.1 (server boot), §4.1 (CLI), §8 C1/C2.

**Sprint-specific risks:**
- Latest-version drift across React 19 / Vite / Drizzle / Hono → detection: `pnpm build` fails on peer-dep mismatch → mitigation: pin the exact resolved latest in `pnpm-lock.yaml`, record versions in S0 WARMDOWN.
- better-sqlite3 native build on arm64 macOS → detection: install error → mitigation: confirm prebuilt binary; fall back to `node:sqlite` only with explicit RFC amendment.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared.

---

### Sprint 1 — Backend core (REST + SSE)

**Goal:** A client can CRUD projects/tasks, round-trip a canvas of nodes + labeled edges, link a document to a task, and receive an SSE `task_updated` within 500 ms of a PATCH — all through one service layer that is the single SSOT.

| Story | Description | DoD |
|-------|-------------|------|
| S1-01 | REST projects + tasks (C3) behind a **service layer** (`taskService`/`projectService`) that both REST and (later) MCP call — the SSOT enforcement from §4.7/review note. Status enum `scope\|todo\|in_progress\|done\|backlog`. | `POST/GET /projects`, `GET /projects/:id`, `GET /projects/:id/tasks`, `PATCH /tasks/:id`; invalid status → 400 `invalid_argument`; happy + failure tests; all mutations route through the service. |
| S1-02 | REST canvas + edges (C4) with the **§4.7 concurrency fix**: `PUT /projects/:id/canvas` persists **layout only** (x/y/edges); task semantic fields (status/label/description) go through `PATCH /tasks/:id`. Edge labels per §5.3 enum (free-text allowed). | `test:canvas_roundtrip` green (PUT 3 nodes + 2 labeled edges; GET matches coords + labels); a concurrent task PATCH is **not** clobbered by a subsequent layout PUT (regression test). |
| S1-03 | REST documents (C5): document tree, `POST /projects/:id/documents` with `linkedNodeId`, `GET /documents/:id`, `PATCH /documents/:id`, `GET /tasks/:id/document`. Markdown/JSON-AST body + `status_line`. | `test:doc_link` green (create doc with `linkedTaskId` → `GET /tasks/:id/document` returns it); doc must belong to project (cross-project link → 400). |
| S1-04 | SSE event bus (C6): `GET /api/v1/events` via `streamSSE`, in-process `eventBus` emitted **inside the service layer** so every mutation (REST now, MCP later) broadcasts. Abort cleanup on disconnect. | `test:sse_task_update` green (EventSource receives `task_updated` < 500 ms after PATCH); disconnect unsubscribes (no leak). |

**Demo:** curl transcript: create project → create task → PATCH status (SSE client in another shell prints `task_updated` < 500 ms) → PUT canvas with edges → GET canvas matches → create linked doc → GET task document.

**Dependencies:** Sprint 0.

**Source RFC §:** §4.2 (REST), §3 REQ-1/2/3/4/5/9, §6.2/6.4, §4.7 (canvas-concurrency fix), §9.1 tests.

**Sprint-specific risks:**
- SSOT erosion: a route mutating the DB directly and skipping SSE → detection: a mutation with no corresponding `task_updated`/`canvas_updated` event in tests → mitigation: service layer is the only write path; lint/review check that routes never import the DB client directly.
- Last-write-wins canvas clobber (the bug §4.7 fixes) → detection: regression test in S1-02 → mitigation: layout-only PUT design.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared.

---

### Sprint 2 — MCP + portability

**Goal:** Claude/Codex can connect to `/mcp/` with a hashed bearer token, list ≥8 tools, `update_task` and see it in REST GET + SSE, and a project exports→imports losslessly via the CLI.

| Story | Description | DoD |
|-------|-------------|------|
| S2-01 | MCP server + token auth (C7): official MCP TypeScript SDK, Streamable HTTP transport mounted at `/mcp/`, `Authorization: Bearer plandesk_mcp_*` validated against `mcp_tokens` (sha256 at rest; raw shown once). Read tools: `list_projects`, `get_project`. | `cmd:mcp_list_tools` (MCP inspector session lists ≥8 declared tools incl. read+write); valid token authenticates; revoked/absent token → HTTP 401. |
| S2-02 | MCP write tools (C8) as thin adapters over the **same service layer** (no second write path): `create_task`, `update_task`, `create_document`, `update_document`, `create_edge`, `start_agent_run`, `record_agent_progress`, `complete_agent_run`. **No delete tool** (RFC §10 safety). | `test:mcp_update_task` green (MCP `update_task` → REST GET reflects → SSE `task_updated` received); unknown project → tool error `not_found`; invalid status → `invalid_argument`. |
| S2-03 | Export / import (C9): `export_project` → `plandesk-export-v1` JSON (project, tasks, edges, documents, agent_runs); `import_project` validates version, remaps IDs in a transaction. | `test:export_import` green (export A → import B → node/edge/doc counts + content deep-equal; edges + doc links preserved). |
| S2-04 | CLI complete (C10): `plandesk export --project --out`, `plandesk import --in`, `plandesk token create --name`, `plandesk doctor`. Corrupt DB → exit 2 suggest doctor. | Each command works end-to-end against a running/served DB; `token create` prints raw token once and stores only the hash; `doctor` reports DB + migration health. |

**Demo:** MCP inspector transcript: connect with created token → `list_tools` (≥8) → `get_project` → `update_task` → REST GET shows new status + SSE fired. CLI: `export` then `import` round-trip with deep-equal assertion output.

**Dependencies:** Sprint 1 (service layer + SSE).

**Source RFC §:** §4.1, §4.3, §3 REQ-7/8/10, §6.3/6.5, §7.2, §10.1/10.2, §9.1 tests.

**Sprint-specific risks:**
- MCP SDK transport API churn (Streamable HTTP) → detection: SDK version mismatch at build → mitigation: pin latest SDK, fetch live docs via Context7 before wiring; lock the transport contract in a test.
- Token leak via logs → detection: review grep for raw token in log statements → mitigation: only ever log the hash/prefix.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared.

---

### Sprint 3 — Web: shell + canvas + docs

**Goal:** The React SPA lists projects, renders the flow canvas where a dragged node and a drawn labeled edge persist across reload, and a node click reaches its linked TipTap document in one navigation.

| Story | Description | DoD |
|-------|-------------|------|
| S3-01 | Web shell + routing (C11): React 19 + Vite + **TanStack Router (SPA mode)** + TanStack Query; routes `/`, `/projects/:id/overview`, `/projects/:id/flow`, `/projects/:id/board`, `/projects/:id/documents/:docId`, `/settings/mcp`; typed search params for task filters; API client + SSE subscription hook. | `pnpm --filter plandesk-web build` green; routes load; project list renders from `GET /projects`; typed search-param filter compiles. |
| S3-02 | Flow canvas UI (C12): `@xyflow/react`, task-card node type, labeled-edge type, drag → debounced **layout-only** PUT (matches §4.7 backend), draw edge → `create_edge`/canvas PUT, edge-label enum suggestions (§5.3). | `A-UI-1`: drag a node + draw a labeled edge → reload → both persist (verified live in browser); semantic status badge reads from task PATCH path, not the layout PUT. |
| S3-03 | Document editor UI (C13): TipTap editor on `/projects/:id/documents/:docId`, reader/editor modes, `Status:` line, save via `PATCH /documents/:id`; canvas node "open doc" navigates here. | `A-UI-2`: click a canvas node linked to a doc → document editor opens in one navigation; edits persist via PATCH; XSS-sanitized render (§10.1). |

**Demo:** Screen recording: open SPA → pick project → drag nodes, draw a `blocks` edge → reload (persists) → click node → TipTap doc opens, edit, persists.

**Dependencies:** Sprint 1 (REST canvas/docs), Sprint 2 optional.

**Source RFC §:** §4.5 (TanStack Router SPA), §7.3, REQ-1/2/3, A-UI-1/A-UI-2, §10.1 (XSS/CSP).

**Sprint-specific risks:**
- xyflow controlled-state churn causing save storms → detection: network tab shows PUT on every pixel → mitigation: debounce + layout-only diff payloads.
- TipTap → stored format mismatch with REST `body` (Markdown vs JSON AST) → detection: round-trip test → mitigation: fix the storage contract in S1-03/S3-03 and assert it.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared.

---

### Sprint 4 — Web: board + MCP settings + agent runs

**Goal:** Moving a card between board columns updates the canvas node's status badge live, an MCP token can be created/copied-once/revoked from Settings, and an external agent run's progress is visible on the canvas.

| Story | Description | DoD |
|-------|-------------|------|
| S4-01 | Board view (C14): kanban columns by status, drag card → `PATCH /tasks/:id` status; canvas node badge updates via SSE (single SSOT, REQ-5). | `A-UI-3`: move a card to another column → the flow node's status badge changes live (SSE) without reload; board and canvas never diverge. |
| S4-02 | MCP settings UI (C15): `/settings/mcp` — create token (calls `token create`), show raw **once** with copy, list active tokens, revoke. | Create → raw shown once + copy works; refresh hides raw; revoke → subsequent MCP call returns 401 (verified against backend). |
| S4-03 | Agent run UI (C16): canvas "Agents activity" panel showing `start_agent_run`/`record_agent_progress`/`complete_agent_run` events live via SSE. | Start a run (via MCP or REST) → progress events appear on the canvas panel < 500 ms; completed run shows terminal state. |

**Demo:** Screen recording: drag board card → canvas badge flips live; Settings → create token, copy, revoke, show 401; trigger an MCP agent run → progress streams into the canvas panel.

**Dependencies:** Sprint 2 (MCP tokens + agent-run tools), Sprint 3 (canvas).

**Source RFC §:** §5.2, REQ-5/8/9, A-UI-3, §4.2 (agent-runs endpoints).

**Sprint-specific risks:**
- Board/canvas divergence (REQ-5 abort condition, §11) → detection: a status shown differently in the two views → mitigation: both read the same task query + SSE invalidation; explicit cross-view test.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared.

---

### Sprint 5 — Distribution + integration + dogfood

**Goal:** `plandesk connect` wires a real repo (`.plandesk/` + commit-safe `.mcp.json` + idempotent CLAUDE.md/AGENTS.md include), `docker compose up` serves the UI on :3847, the Factory Desk MCP-client adapter lists projects, and the dogfood fixture imports clean.

| Story | Description | DoD |
|-------|-------------|------|
| S5-01 | `plandesk connect` + `.plandesk/` + skill (C17 + RFC §4.7): connect/disconnect/doctor subcommands, write `.plandesk/{config.json,skill.md}` (committed) + git-ignored `token`, project-scoped `.mcp.json` with `${PLANDESK_MCP_TOKEN}` expansion, idempotent sentinel-block include in CLAUDE.md/AGENTS.md, `.codex/commands/plandesk.md`. Ship `.plandesk/skill.md` template from §4.7.5. | `plandesk connect --print` dry-run shows exact files; real run in a temp repo writes all artifacts idempotently (re-run = no dup); token never lands in a committed file; `disconnect` cleanly removes; `doctor` validates binding. |
| S5-02 | Docker self-host (C18): `Dockerfile` (build web + bundle API/CLI) + `docker-compose.yml` honoring RFC platform rules (single small container, loopback by default; `0.0.0.0` only with `PLANDESK_AUTH_PASSWORD`). | `docker compose up` serves the UI + API on :3847; volume persists `workspace.db`; container runs as non-root. |
| S5-03 | Factory Desk adapter (C19): `packages/plandesk-mcp-client/` consumer SDK reading `PLANDESK_URL`/`PLANDESK_MCP_TOKEN`, `list_projects`; no canvas state duplicated. | `test:factory_adapter_smoke` green (client with a test token lists ≥1 project over MCP); documented REST/MCP-only coupling (REQ-12). |
| S5-04 | Dogfood project (C20): `examples/checkout-revamp.json` (`plandesk-export-v1`) mirroring the case-study shape; import + MCP-inspect verifies. | Import fixture → project graph matches; MCP `get_project` returns the case-study shape; used as the demo project for the README. |

**Demo:** Transcript: `plandesk connect` inside a throwaway repo → show `.plandesk/`, `.mcp.json` (env-var, no secret), CLAUDE.md sentinel block, re-run is idempotent → `docker compose up` serves UI → adapter lists projects → import dogfood fixture.

**Dependencies:** Sprint 2 (MCP + CLI), Sprint 4 (UI for demo).

**Source RFC §:** §4.6, §4.7 (full), §3 REQ-6/11/12, §10 (security/token handling), §8 C17/C18/C19/C20.

**Sprint-specific risks:**
- `.mcp.json` token leak if a worker inlines the raw token → detection: grep committed files for `plandesk_mcp_` → mitigation: env-var expansion only; `.gitignore` covers `.plandesk/token`; security assertion test.
- Idempotency bug duplicating CLAUDE.md blocks → detection: re-run connect twice, diff → mitigation: sentinel markers + replace-between.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared.

---

### Sprint 6 — Polish + 1.0

**Goal:** Every §9 fail-to-pass test and validation command is green, the v1 measurable-outcome metrics (cold start <5 s, MCP list/inspect <2 s p95, SSE <500 ms, lossless export) are measured and met, and the repo ships a 1.0 tag with full setup docs.

| Story | Description | DoD |
|-------|-------------|------|
| S6-01 | Full validation suite (§9): wire every fail-to-pass test + §9.3 validation commands into `pnpm test` + a `scripts/validate.sh`; regression tests (migration up/down; token revoke → 401). | `pnpm test` green incl. all of `test:canvas_roundtrip`, `test:doc_link`, `test:sse_task_update`, `test:mcp_update_task`, `test:export_import`, `test:factory_adapter_smoke`; `scripts/validate.sh` runs the §9.3 curl/MCP commands green. |
| S6-02 | Metrics gate (§1 measurable outcomes): measure cold start to first project, MCP list+inspect p95 on localhost, SSE broadcast latency, export/import losslessness; record results. | Recorded numbers meet targets (cold start <5 s, MCP <2 s p95, SSE <500 ms, lossless export); committed `METRICS.md` with the rig + results. |
| S6-03 | Docs + release 1.0: top-level README (quickstart, self-host, MCP setup following the standard flow), `docs/mcp-setup.md`, `docs/skills/plandesk-mcp.md`, CHANGELOG; tag `v1.0.0`. | A new developer can follow the README from clone → serve → connect an agent → run the dogfood project; §10 threat-model checklist verified; `v1.0.0` tag on green CI. |

**Demo:** Full cold-path walkthrough recording: clone → `pnpm install && pnpm build` → `plandesk init && plandesk serve` → open UI → `plandesk connect` an agent repo → agent inspects the dogfood project over MCP and updates a task → board/canvas reflect it. Plus the metrics table.

**Dependencies:** Sprints 0–5.

**Source RFC §:** §9 (validation), §1 (measurable outcomes), §10 (security), §11 (abort criteria as final checklist).

**Sprint-specific risks:**
- Metrics miss on cold start (Vite bundle size / better-sqlite3 init) → detection: S6-02 measurement → mitigation: lazy-init, prebuilt assets; if structural, surface as RFC amendment rather than gaming the number.

**Exit criteria:** all stories Done; WARMDOWN written; HANDOFF prepared; `v1.0.0` tagged.

---

## 4. Backlog (deferred to v1.x or v2)

| ID | Item | Earliest | Source RFC § |
|----|------|----------|--------------|
| B-01 | Stoker-equivalent AI canvas bootstrap (plain-English → generated canvas) | v2 | §2.1, §5.2, Q6 |
| B-02 | Live multi-cursor / presence (Yjs CRDT) | v2 | §5.2, Q5 |
| B-03 | Spaces (group projects by quarter/initiative) | v1.1 | §5.2 |
| B-04 | Orgs + roles + public Tasks tab | v2 | §2.1, §5.2 |
| B-05 | Postgres adapter (team multi-user self-host) | v1.1 | §4.4, Q2 |
| B-06 | `document_comments` (inline passage comments) | v1.1 | §4.4 |
| B-07 | Audit log for MCP writes | v1.1 | §10.1 |
| B-08 | Encrypt-at-rest for SQLite | v2 | §10.1 |
| B-09 | `task.metadata` JSON column (factorySlug mapping) | v1.1 | §4.6 |
| B-10 | Git-native file SSOT (markdown + JSON graph) | v2 | §2.5 |
| B-11 | zero-native desktop wrapper (P5 optional shell) | post-MVP | §2.4 |

---

## 5. Risks tracked across sprints

| Risk | Sprint(s) it materializes | Owner | Mitigation |
|------|---------------------------|-------|------------|
| SSOT erosion (a write path skips the service layer / SSE) — REQ-5 abort condition | 1, 2, 4 | Manager | Single service layer is the only write path; review check that routes/MCP never touch the DB client directly; cross-view board/canvas test. |
| Canvas last-write-wins clobber of concurrent agent edits | 1, 3 | Manager | §4.7 fix: layout-only PUT; semantic fields via PATCH; regression test in S1-02. |
| MCP write does not emit SSE (RFC §11 abort) | 2 | Manager | SSE emitted inside the service layer so MCP inherits it; `test:mcp_update_task` asserts the SSE. |
| Export/import loses edges or doc links (RFC §11 abort) | 2 | Manager | `test:export_import` deep-equal incl. edges + links; block release if red. |
| MCP token leak (committed `.mcp.json` / logs) | 2, 5 | Manager | Hash at rest; `${ENV}` expansion in `.mcp.json`; `.gitignore` for `.plandesk/token`; grep assertion. |
| Latest-version dependency drift (React 19 / Vite / Drizzle / MCP SDK / xyflow / TipTap) | 0, 2, 3 | Manager | Pin resolved latest in lockfile; fetch live docs via Context7 before wiring each; record versions per sprint WARMDOWN. |
| Native better-sqlite3 build on arm64 | 0 | Manager | Verify prebuilt binary at scaffold; fallback only via explicit RFC amendment. |
| Metrics miss (cold start / MCP p95 / SSE) | 6 | Manager | Measure early in S6-02; optimize honestly, never game the number; structural misses → RFC amendment. |

---

## 6. The role of this document

This WBS is the *plan*, not the *prompt*. The program driver lives at [`./SESSION_KICKOFF_PROMPT.md`](./SESSION_KICKOFF_PROMPT.md). The current sprint pointer lives at [`./STATE.md`](./STATE.md). Templates live under [`./templates/`](./templates/).

When this WBS conflicts with the source RFC(s), **the RFC(s) win** — amend the RFC (and this document) in the same round. The one place this build deliberately *extends* the RFC's §8 chunk list is the `plandesk connect` command + `.plandesk/` directory (RFC §4.7, added this program), folded into Sprint 5 / story S5-01.
