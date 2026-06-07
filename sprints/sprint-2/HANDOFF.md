# Sprint 2 → Sprint 3 Handoff

**Read me first.** One page to start Sprint 3 (Web: shell + canvas + docs).

## State of the world

- `main`, all green: `pnpm build && pnpm test && pnpm lint` (137 backend tests).
- **Complete local backend:** REST + SSE + MCP (read+write, agent runs) + export/import + CLI. `plandesk serve` → `127.0.0.1:3847` serves the API; the web SPA will be served from the same origin (static hook already in api).
- Web app (`apps/plandesk-web`) is a **compiling shell** with TanStack Router already scaffolded (from S0-01) — routes/__root.tsx, routes/index.tsx, routeTree.gen.ts. Builds green; no real screens yet.

## What Sprint 3 builds (WBS § Sprint 3)

The React SPA: shell + flow canvas + document editor.

- **S3-01** Web shell + routing: React 19 + Vite + **TanStack Router (SPA)** + TanStack Query; routes `/`, `/projects/:id/overview`, `/projects/:id/flow`, `/projects/:id/board`, `/projects/:id/documents/:docId`, `/settings/mcp`; typed search params for task filters; an API client + an SSE subscription hook (`GET /api/v1/events`).
- **S3-02** Flow canvas (`@xyflow/react`): task-card nodes, labeled edges, drag → **debounced layout-only PUT** (matches §4.7 backend — send only x/y + edges, never status/label), draw edge → create_edge/canvas PUT, edge-label enum suggestions (§5.3). `A-UI-1`: drag + draw edge persists across reload.
- **S3-03** Document editor (TipTap): `/projects/:id/documents/:docId`, reader/editor, `Status:` line, save via `PATCH /documents/:id`; canvas node "open doc" navigates here in one click. `A-UI-2`. XSS-sanitize rendered HTML (§10.1).

## Critical conventions to carry

- **API wire format is snake_case + ISO.** The web client maps these. Endpoints + shapes are in `sprints/sprint-2/review-sprint.md` and `packages/plandesk-api/src/serialize.ts`. Reuse a typed API client; don't hand-roll per call.
- **Canvas PUT is layout-only (§4.7).** The frontend must send only `{nodes:[{id,x,y,label?}], edges, layout?}` on drag-save; task status/label edits go through `PATCH /tasks/:id` (board does this in S4). Debounce the layout PUT.
- **SSE for live updates:** subscribe to `GET /api/v1/events`; invalidate the relevant TanStack Query keys on `task_updated`/`canvas_updated`/`document_created`. This is how the board badge (S4) and canvas stay in sync with MCP/agent writes.
- **Served same-origin:** in dev, Vite proxies `/api` + `/mcp` to `:3847`; in prod the api serves `apps/plandesk-web/dist` (static hook exists). Set up the Vite dev proxy in S3-01.
- React 19, Vite 8, TanStack Router/Query (latest, pinned). ESM, strict TS 6.0.3. No stubs/`@ts-ignore`, atomic `[S3-NN]` commits, no scratch files. **UI stories need a real browser check** (A-UI-1/A-UI-2) — manager will verify in a headless browser.

## Load-bearing reading for Sprint 3

1. `sprints/sprint-2/WARMDOWN.md` + this handoff.
2. `sprints/WBS.md` § Sprint 3 + § 1.2 DoD.
3. `../plandesk-rfc/02-requirements-interfaces.md` §4.5 (frontend stack/routes — TanStack Router SPA), §4.2 (REST shapes), §3 REQ-1/2/3, §4.7 (canvas layout-only), §5.3 (edge vocab).
4. `../plandesk-rfc/03-pseudocode-blueprint.md` §7.3 (FlowCanvas sketch).
5. `packages/plandesk-api/src/serialize.ts` + `routes/*.ts` (exact response shapes); `apps/plandesk-web/src/` (current shell).

## Starting state for Sprint 3

Clean `main`, Sprint 2 closed. Next: write `sprints/sprint-3/PLAN.md`, then brief S3-01 → `/delegate --mode impl --to cursor`. Backend is fully running for the UI to integrate against (`plandesk serve`).
