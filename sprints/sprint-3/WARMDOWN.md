# Sprint 3 Warm-down — Web: shell + canvas + docs

**Closed:** 2026-06-07 · **Status:** ✅ complete · **Build branch:** `main`

## What shipped

The React SPA: shell + flow canvas + document editor — browser-verified.

| Story | Commit | Delivers |
|-------|--------|----------|
| S3-01 | `f3b2f91` | web shell, TanStack Router/Query, typed snake_case API client, SSE-invalidation hook, Vite proxy |
| S3-02 | `5b64790` + `c3e51ad` | `@xyflow/react` flow canvas (layout-only saves) + SPA-fallback fix |
| S3-03 | `06206b7` | TipTap document editor, node→doc one-click, DOMPurify sanitize |

## What's working (browser-verified)

- Project list, project overview; navigate.
- Flow canvas: drag nodes, draw labeled edges, persist across reload (A-UI-1). Layout-only saves.
- Doc editor: linked node → editor in one navigation (A-UI-2); content renders; sanitized.
- SSE invalidation keeps the UI live with MCP/agent writes.
- Same-origin self-host: `plandesk serve` serves SPA + API; deep-links/reloads work.
- 15 web tests; `pnpm build && pnpm test && pnpm lint` green.

## What's NOT done (later sprints)

- **Board view** (drag card → status; canvas badge sync) → S4-01.
- **MCP settings UI** (create/copy-once/revoke token) → S4-02.
- **Agent-runs panel** (live progress on canvas) → S4-03.
- Distribution (`plandesk connect`, Docker, Factory adapter, dogfood) → Sprint 5.
- Metrics + validation suite + 1.0 docs → Sprint 6.

## Decisions / conventions (carry forward)

- **Canvas drag = debounced layout-only PUT** (`buildLayoutPayload` → `{id,x,y}` + edges). Status/label never sent.
- **Board (S4-01) drives status via `PATCH /tasks/:id`** and the canvas badge updates via SSE — do NOT route status through canvas PUT.
- **Doc body = HTML** (TipTap `getHTML`), DOMPurify-sanitized when rendered as stored HTML.
- Typed snake_case API client is the one mapping boundary; SSE hook invalidates Query keys.
- TanStack Router file-based routes; never hand-edit `routeTree.gen.ts`.

## Open issues / RFC amendments

- New (fixed): SPA fallback in the static hook — now serves index.html for client routes.
- Carried: additive `projects.canvas_layout` column (S1); §4.7 `plandesk connect` (S5).
- No blockers. Product usable end-to-end in a browser.
