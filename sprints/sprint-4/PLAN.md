# Sprint 4 — Plan

**Sprint name:** Web: board + MCP settings + agent runs
**Sprint goal:** Moving a card between board columns updates the canvas node's status badge live, an MCP token can be created/copied-once/revoked from Settings, and an external agent run's progress is visible on the canvas.
**Sprint window:** 2026-06-07 → (1w)
**Author:** Opus 4.8 (1M), 2026-06-07

## 1. Stories

### `S4-01` — Board view (C14, A-UI-3)
**Description:** Kanban board at `/projects/:id/board`: columns per status (`scope|todo|in_progress|done|backlog`); drag a card between columns → `PATCH /tasks/:id` status. The flow canvas node badge updates **live via the existing SSE invalidation** — single SSOT (REQ-5). Board reads the same `useTasks` query.
**Acceptance (A-UI-3):** move a card to another column → the flow node's status badge changes **without reload** (SSE); board + canvas never diverge.

### `S4-02` — MCP settings UI + token REST (C15)
**Description:** Add thin REST token endpoints over the `@plandesk/db` token repo: `POST /api/v1/mcp-tokens` (create → raw shown once), `GET /api/v1/mcp-tokens` (list, no secrets), `DELETE /api/v1/mcp-tokens/:id` (revoke). Add `listTokens`/`revokeToken` to the db repo if missing. Settings UI at `/settings/mcp`: create token (show raw once + copy), list active tokens, revoke. Include the `claude mcp add … /mcp/ --header "Authorization: Bearer …"` snippet.
**Acceptance:** create → raw shown once + copy; refresh hides raw; revoke → a subsequent MCP call returns 401 (verified against backend).

### `S4-03` — Agent-runs panel (C16)
**Description:** Add `GET /api/v1/projects/:id/agent-runs` (runs + events) over the agent-run repos. Canvas "Agents activity" panel shows runs + `agent_run_started/progress/completed` live via SSE (history-on-load from the new endpoint + live updates).
**Acceptance:** start a run (via MCP or REST) → progress events appear on the canvas panel < 500 ms; completed run shows terminal state.

## 2. Universal DoD (per story)
- [ ] `pnpm build && pnpm test && pnpm lint` green; happy+failure tests.
- [ ] UI stories browser-verified (A-UI-3 especially).
- [ ] Board status via `PATCH /tasks/:id` (taskService), NOT canvas PUT; canvas badge via SSE.
- [ ] Token: raw shown once, sha256 at rest; revoke → 401.
- [ ] No stubs/`@ts-ignore`/scratch files; atomic `[S4-NN]` commit; snake_case.

## 3. Test plan
| Story | Test |
|-------|------|
| S4-01 | board render + drag→PATCH; **browser A-UI-3 (badge sync)** |
| S4-02 | token routes happy/failure (create/list/revoke→401); settings UI render |
| S4-03 | agent-runs endpoint; panel renders live SSE events |

## 4. Demo
Drag a board card → canvas badge flips live; Settings → create token, copy, revoke, show 401; trigger an MCP agent run → progress streams into the canvas panel.

## 5. Risks
| Risk | Detection | Mitigation |
|------|-----------|------------|
| Board/canvas divergence (REQ-5 abort, §11) | a status differs across views | both read `useTasks`; SSE invalidation; cross-view browser test |
| Token raw leak in UI state after refresh | raw visible post-reload | raw held only in-memory post-create; never refetched |
| Agent-run panel missing history on load | empty until next event | history-on-load endpoint + live SSE |

## 6. Open questions
- Drag-and-drop lib for the board: use a lightweight latest dnd (e.g. `@dnd-kit/core`) or HTML5 DnD. Pick one; keep deps minimal. Status change is the contract regardless of lib.
