# Sprint 3 — Plan

**Sprint name:** Web: shell + canvas + docs
**Sprint goal:** The React SPA lists projects, renders the flow canvas where a dragged node and a drawn labeled edge persist across reload, and a node click reaches its linked TipTap document in one navigation.
**Sprint window:** 2026-06-07 → (1w)
**Author:** Opus 4.8 (1M), 2026-06-07

## 1. Stories

### `S3-01` — Web shell + routing + API client (C11)
**Description:** React 19 + Vite + TanStack Router (SPA) + TanStack Query. Routes `/`, `/projects/:id/overview`, `/projects/:id/flow`, `/projects/:id/board`, `/projects/:id/documents/:docId`, `/settings/mcp`. Typed API client over the REST surface (snake_case), typed search params for task filters, an SSE subscription hook that invalidates Query keys, Vite dev proxy for `/api` + `/mcp` → :3847.
**Acceptance:** `pnpm --filter plandesk-web build` green; project list renders from `GET /projects` (live against `plandesk serve`); navigating to a project shows its overview; typed search-param filter compiles + works; SSE hook invalidates on `task_updated`.

### `S3-02` — Flow canvas (C12, A-UI-1)
**Description:** `@xyflow/react` canvas at `/projects/:id/flow`: task-card node type, labeled-edge type, drag node → debounced **layout-only** PUT (x/y + edges only), draw edge → canvas PUT/create_edge, edge-label enum suggestions (§5.3). Status badge on the node reads from the task (not written by layout PUT).
**Acceptance (A-UI-1):** drag a node + draw a labeled edge → reload → both persist (verified live in a browser). Layout save never sends status/label.

### `S3-03` — Document editor (C13, A-UI-2)
**Description:** TipTap editor at `/projects/:id/documents/:docId`: reader/editor modes, `Status:` line, save via `PATCH /documents/:id`; a canvas node linked to a doc has an "open doc" affordance navigating here in one click. Sanitize rendered HTML (CSP, §10.1).
**Acceptance (A-UI-2):** click a linked canvas node → document editor opens in one navigation; edits persist via PATCH.

## 2. Universal DoD (per story)
- [ ] `pnpm build && pnpm test && pnpm lint` green.
- [ ] UI stories: **real browser verification** (manager runs a headless browser against `plandesk serve`).
- [ ] Canvas layout PUT is layout-only (no status/label in the payload).
- [ ] SSE invalidation wired (live updates without reload).
- [ ] No stubs/`@ts-ignore`/scratch files; atomic `[S3-NN]` commit; snake_case API mapping.

## 3. Test plan
| Story | Test |
|-------|------|
| S3-01 | component/render tests (project list, routing); API client unit |
| S3-02 | canvas interaction (vitest + testing-library where feasible) + **browser A-UI-1** |
| S3-03 | editor save + link nav + **browser A-UI-2** |

## 4. Demo
Screen recording: open SPA → pick project → drag nodes, draw a `blocks` edge → reload (persists) → click node → TipTap doc opens, edit, persists.

## 5. Risks
| Risk | Detection | Mitigation |
|------|-----------|------------|
| xyflow save-storm on drag | network tab PUT per pixel | debounce + layout-only diff payloads |
| TipTap body vs stored Markdown mismatch | round-trip test | store body string faithfully; assert round-trip |
| snake_case mapping errors | type errors / undefined fields | one typed API client; map at the boundary |
| Vite dev proxy missing | API calls 404 in dev | configure proxy in S3-01 |

## 6. Open questions
- Body format: store/serve `body` as Markdown string (S1 decision); TipTap serializes to/from Markdown. If JSON-AST is needed, that's an explicit amendment — default Markdown.
