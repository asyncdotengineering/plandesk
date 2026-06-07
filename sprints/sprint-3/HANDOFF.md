# Sprint 3 → Sprint 4 Handoff

**Read me first.** One page to start Sprint 4 (Web: board + MCP settings + agent runs).

## State of the world

- `main`, all green: `pnpm build && pnpm test && pnpm lint` (137 backend + 15 web tests).
- SPA usable in a browser: project list → flow canvas (drag, labeled edges) → linked TipTap docs. Served same-origin by `plandesk serve`; deep-links work.
- API client (`apps/plandesk-web/src/lib/api.ts`) + Query hooks (`queries.ts`) + SSE invalidation (`events.ts`) all in place. Routes for board/settings exist as **placeholders**.

## What Sprint 4 builds (WBS § Sprint 4)

- **S4-01** Board view (`/projects/:id/board`): kanban columns by status; drag a card → `PATCH /tasks/:id` status; the **canvas node badge updates live via SSE** (REQ-5 single SSOT). A-UI-3: move card → flow badge changes without reload.
- **S4-02** MCP settings UI (`/settings/mcp`): create token (needs a REST endpoint — see below), show raw **once** + copy, list active tokens, revoke. Revoke → subsequent MCP call 401.
- **S4-03** Agent-runs panel: canvas "Agents activity" showing `agent_run_started/progress/completed` live via SSE.

## Critical conventions to carry

- **Board status goes through `PATCH /tasks/:id`** (taskService), NOT canvas PUT. The canvas badge re-renders from the `task_updated` SSE invalidation already wired in S3-01. This is how board + canvas stay the single SSOT (REQ-5).
- **MCP token endpoints:** S2 added the `mcp_tokens` repo + CLI `token create`, but there is **no REST endpoint** for token create/list/revoke yet. S4-02 needs to add `POST /api/v1/mcp-tokens` (returns raw once), `GET /api/v1/mcp-tokens` (no secrets), `DELETE /api/v1/mcp-tokens/:id` (revoke) — thin routes over the existing `@plandesk/db` token repo (createToken/listTokens/revokeToken; add list/revoke if missing). Then the settings UI calls them.
- **Agent-run history:** events broadcast via SSE; if the panel needs history-on-load, add `GET /api/v1/projects/:id/agent-runs` (+ events) — thin over the agent-run repos from S2-02.
- snake_case API; SSE invalidation; debounced where needed; React 19 + TanStack; strict TS 6.0.3; no stubs/`@ts-ignore`; atomic `[S4-NN]` commits; no scratch files. **UI stories: browser-verify** (A-UI-3 especially).

## Load-bearing reading for Sprint 4

1. `sprints/sprint-3/WARMDOWN.md` + this handoff.
2. `sprints/WBS.md` § Sprint 4 + § 1.2 DoD.
3. `../plandesk-rfc/02-requirements-interfaces.md` §4.2 (REST), §3 REQ-5/8/9, §5.2 (board), §4.3 (tokens).
4. `packages/plandesk-api/src/{services,routes}/*` + `serialize.ts`; `packages/plandesk-db/src/repositories/tokens.ts` + agent-run repos.
5. `apps/plandesk-web/src/lib/{api.ts,queries.ts,events.ts}` + `components/canvas/*`.

## Starting state for Sprint 4

Clean `main`, Sprint 3 closed. Next: write `sprints/sprint-4/PLAN.md`, then brief S4-01 → `/delegate --mode impl --to cursor`. Note S4-02 needs small REST token endpoints added first (or as part of that story).
