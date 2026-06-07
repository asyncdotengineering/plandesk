# Sprint 3 Review (Phase B) — Web: shell + canvas + docs

**Reviewer:** Manager (Opus 4.8), 2026-06-07
**Scope:** `f3b2f91`, `5b64790`, `c3e51ad`, `06206b7` on `main`
**Sprint goal:** SPA lists projects; flow canvas where a dragged node + drawn labeled edge persist across reload; node click reaches its linked doc in one navigation.

## Verdict: **SOLID — shipping.** Goal met; both A-UI criteria verified in a real browser.

## Layer 1 — What works (grounded, browser-verified)

- **Canvas is real.** `@xyflow/react@12.11.0` renders task-card nodes + labeled edges; live browser: react-flow mounted, nodes=2, edges=1, labels visible. Drag saves a **layout-only** payload (`buildLayoutPayload` emits only `{id,x,y}` per node) — the §4.7 clobber path is closed at the client too. A-UI-1 (drag + edge persist across reload) verified.
- **Docs are real.** TipTap `3.26.0` editor; linked node → "Open doc →" → editor in **one navigation** (A-UI-2, browser-verified); content renders; stored HTML DOMPurify-sanitized (§10.1).
- **Shell + data flow.** TanStack Router (file-based) + Query; typed snake_case API client (one boundary); SSE hook invalidates Query keys on `task_updated`/`canvas_updated`/`document_created` — UI stays live with MCP/agent writes. Vite dev proxy for `/api`+`/mcp`.
- **Same-origin self-host.** `plandesk serve` serves the built SPA + API on one port; deep-links/reloads work (after the SPA-fallback fix).
- 15 web tests; `pnpm build && pnpm test && pnpm lint` green.

## Layer 2 — Blockers / majors

**None blocking.** One manager fix, a real production bug caught by browser testing:

- **SPA fallback missing** (`c3e51ad`): static hook 404'd on client deep-links/reloads. Added `index.html` fallback for non-`/api`/`/mcp` GETs. Without browser testing this would have shipped — unit tests don't catch it. Fixed + live-verified.

Notes (not debt):
- Edit→save→reload was verified via the save path (`getHTML → PATCH`, PATCH proven in S1-03) + component test, not a keystroke-level browser drive. The navigation + render half is browser-verified. Low risk; full keystroke E2E can be added in S6 if desired.
- Canvas drag is debounced layout-only; board (S4) will drive status via PATCH and the canvas badge updates via SSE.

## Layer 3 — Verdict

**SOLID — shipping.** The product is now usable end-to-end in a browser: list → canvas (drag, draw labeled deps) → linked docs. Advance to **Sprint 4 (board + MCP settings UI + agent-runs panel)** — completing the UI surface and closing the visible agent loop.

## Process note (per user)

Story-completion detection now double-checked: each worker is fired via `run_in_background` (per-story completion notification) **and** the authoritative git commit + sentinel SHA is verified before every review. A persistent sentinel-watching Monitor was trialed and dropped (redundant + noisy in the monitor shell); the fire-notification + commit-check is the robust path.

## Risk-register check (WBS §5)

- *xyflow save-storm* — mitigated: debounced layout-only saves.
- *Canvas clobber from UI* — closed: `buildLayoutPayload` is layout-only by type + impl.
- *TipTap format mismatch* — resolved: HTML round-trip, consistent.
- *Deep-link 404 (new, found in S3)* — fixed: SPA fallback.

## UI surface delivered (for S4)

Routes live: `/`, `/projects/:id/{overview,flow,board(placeholder),documents/:docId}`, `/settings/mcp (placeholder)`. Canvas + doc editor real; board + settings + agent-runs panel are S4.
