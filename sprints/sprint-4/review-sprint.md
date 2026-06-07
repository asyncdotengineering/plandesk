# Sprint 4 Review (Phase B) — Web: board + MCP settings + agent runs

**Reviewer:** Manager (Opus 4.8), 2026-06-08
**Scope:** `bbd0bfd`, `a59b9ca`, `fbf5452` on `main`
**Sprint goal:** Board column move updates the canvas badge live; MCP token create/copy-once/revoke from Settings; agent-run progress visible on the canvas.

## Verdict: **SOLID — shipping.** Goal met; all three verified live in a real browser. The visible agent loop is complete.

## Layer 1 — What works (grounded, browser + REST verified)

- **Board ↔ canvas single SSOT (A-UI-3).** Board drag → `PATCH /tasks/:id` (never canvas PUT); the canvas badge updated **live from todo→done via SSE without reload** — observed in-browser. `@dnd-kit/core@6.3.1`.
- **Full token lifecycle (REQ-8).** REST `POST` (raw once) / `GET` (no hash/raw — scanned) / `DELETE` (revoke); MCP call with token → 200, **after revoke → 401**. Settings UI renders + shows the `claude mcp add …/mcp/` snippet.
- **Visible agent loop (the agent-loop signature).** MCP `start_agent_run`/`record_progress`/`complete` → `GET /agent-runs` (runs+events) → "Agents activity" panel shows the run and **updated RUNNING→COMPLETED live** via SSE. The S1 "emit in services" + S3 "SSE invalidation" decisions pay off again — agent writes light up the UI with no per-feature wiring.
- 182 tests (api 77, web 31, db 40, mcp 8, cli 26); build + lint green.

## Layer 2 — Blockers / majors

**None.** No manager code fixes this sprint. One environment issue handled:

- **Leaked test servers** — my live-verification `plandesk serve` instances didn't all get reaped, and a stray one collided with the CLI port-in-use test (transient 11/12). Reaped 10; suite 12/12. Process discipline note, not a product defect. Adopted: reap servers + agent stragglers each round.

Notes (not debt):
- Agent-run panel status text is uppercased in the UI (RUNNING/COMPLETED) — purely presentational.
- `GET /agent-runs` returns full event history; fine for v1 volumes.

## Layer 3 — Verdict

**SOLID — shipping.** The **entire UI surface is feature-complete**: overview, flow canvas (drag + labeled deps), board (status, SSOT), documents (TipTap), MCP settings (tokens), agent-runs panel. A self-hoster can run the whole graph-native loop locally in a browser. Advance to **Sprint 5 (distribution: `plandesk connect` + `.plandesk/`, Docker, Factory adapter, dogfood)** — the RFC §4.7 work this program added.

## Risk-register check (WBS §5)

- *Board/canvas divergence (REQ-5 abort)* — closed: both read `useTasks`; SSE; A-UI-3 live-verified.
- *Token raw leak* — closed: list omits secrets (scanned); raw only on create.
- *Agent-run panel missing history* — closed: history endpoint + live SSE.

## UI complete — surface for Sprint 5/6

Routes live + real: `/`, `/projects/:id/{overview,flow,board,documents/:docId}`, `/settings/mcp`. SSE-driven live updates across canvas/board/panel. Next: distribution + dogfood + polish/1.0.
