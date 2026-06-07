# Proceed Evidence — S4-02 MCP settings UI + token REST (C15)

**Verdict:** `PROCEED` (no fix)
**IC commit:** `a59b9ca` `[S4-02] MCP settings UI + token REST` (cursor)
**Date:** 2026-06-08

## Acceptance criteria (PLAN §S4-02)

| # | Criterion | Result (live) |
|---|-----------|---------------|
| 1 | POST raw once; GET no secrets; DELETE revoke | ✅ POST→token+id; GET keys `[id,name,created_at,revoked_at]`, no leak; DELETE→204 |
| 2 | Settings UI: create/copy/list/revoke + snippet | ✅ renders in browser |
| 3 | **Revoke → subsequent MCP call 401** | ✅ token→200, revoke→204, **after revoke→401** |

## Independent verification (manager-run, LIVE)

- `POST /api/v1/mcp-tokens {name}` → `{id, token: plandesk_mcp_…}` (raw once).
- `GET /api/v1/mcp-tokens` → list with keys `id,name,created_at,revoked_at`; regex scan for `token_hash`/`"token"` → **no leak**.
- MCP `initialize` with the token → **200**; `DELETE /mcp-tokens/:id` → **204**; MCP `initialize` again → **401**. Full create→use→revoke→401 lifecycle.
- `serializeToken` returns only non-secret fields; the four token repo fns (create/verify/list/revoke) backed the routes.
- Settings UI renders at `/settings/mcp` (browser).
- Gates: build 6/6, api 73 tests, web 28 tests, lint+Prettier clean. No strays/leaks/stragglers.

→ Proceed to **S4-03 (Agent-runs panel)** — last story of Sprint 4.
