# Proceed Evidence — S3-02 Flow canvas (C12, A-UI-1)

**Verdict:** `PROCEED`
**IC commit:** `5b64790` `[S3-02] Flow canvas` (cursor)
**Manager fix:** `c3e51ad` `[S3-02-fix]` (SPA fallback routing)
**Date:** 2026-06-07

## Acceptance criteria (PLAN §S3-02)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `/projects/:id/flow` renders nodes + labeled edges | ✅ **real browser:** react-flow mounted, nodes=2, edges=1 |
| 2 | Drag → debounced **layout-only** PUT (x/y only) | ✅ `buildLayoutPayload` maps nodes to only `{id,x,y}` |
| 3 | Draw edge → persists with §5.3 label | ✅ default `depends_on`; round-trip persists |
| 4 | **A-UI-1: drag + edge persist across reload (browser)** | ✅ verified (below) |

## Independent verification (manager-run)

- **Layout-only proven at the type + impl level:** `PutCanvasInput.nodes` is `{id?,x,y,label?}` — status/description can't be expressed; `buildLayoutPayload` emits only `{id,x,y}` per node, edges with from/to + label. The §4.7 clobber path is closed at the client too.
- **Persistence round-trip (exact canvas data path):** load canvas → layout PUT with new positions + a `depends_on` edge → reload GET → node at (55,140), edge n1→n2 `depends_on`, `PASS:true`.
- **Real browser render (agent-browser):** opened `/projects/:id/flow` → `.react-flow` MOUNTED, `nodes=2, edges=1`; DOM shows "Build checkout", "Payment gateway", "depends_on". Screenshot `artifacts/s3-02-canvas.png` (40 KB rendered canvas).
- xyflow `@xyflow/react@12.11.0` (latest). Gates: build 6/6, web 9 tests, lint+Prettier clean. No strays/leaks.

## Manager fix (real production bug, found via browser test)

- **SPA fallback missing.** The static hook served assets but 404'd on client deep-links/reloads (`/projects/:id/flow` → API not_found). Added `index.html` fallback for non-`/api`/`/mcp` GETs. Live: deep-link → 200; unknown `/api` → 404 JSON preserved. This makes self-host reloads/deep-links work for **every** client route (canvas, board, docs, settings).

→ Proceed to **S3-03 (Document editor, A-UI-2)**.
