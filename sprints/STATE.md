# Project State

> **Single source of truth for "where are we right now."** Updated at the end of every sprint warm-down.

---

## Active sprint

**Sprint number:** `2`
**Sprint name:** MCP + portability
**Status:** `not-started`
**Goal:** Claude/Codex can connect to `/mcp/` with a hashed bearer token, list ≥8 tools, `update_task` and see it in REST GET + SSE, and a project exports→imports losslessly via the CLI.
**WBS section:** [`sprints/WBS.md` § Sprint 2](./WBS.md)

## Build branch

**Active build branch:** `main`

Every sprint session — manager and IC — works **on this branch only**. This is a fresh local repo with no trunk/PR model; the user asked for atomic commits per round on the local repo, so `main` is explicitly the build branch. Before Step 1 of the kickoff, confirm `git branch --show-current` matches. All story commits (`[S{N}-{nn}]`), fix-pass (`[S{N}-fix]`), and closeout (`[S{N}-close]`) land here.

At session start: `git checkout main`.

## Load-bearing reading for sprint 2

The session running sprint 2 must read these in this order before delegating any story:

1. `sprints/sprint-1/HANDOFF.md` — **read first**; state of the world + MCP-reuses-services rule.
2. `sprints/WBS.md` § Sprint 2 + § 1.2 DoD.
3. `sprints/SESSION_KICKOFF_PROMPT.md` — the loop you are running.
4. `../plandesk-rfc/02-requirements-interfaces.md` — §4.1 (CLI), §4.3 (MCP tools/endpoint), §3 REQ-7/8/10.
5. `../plandesk-rfc/03-pseudocode-blueprint.md` — §6.3 (MCP exec loop), §6.5 (export/import), §7.2 (update_task tool).
6. `../plandesk-rfc/05-security-rollback-open-qs.md` — §10 (token handling, no mass-delete).
7. `sprints/sprint-1/WARMDOWN.md` — conventions (snake_case serialize, services-as-write-path, eventBus).

## Last completed sprint

`1 — Backend core (REST + SSE)`

## Last completed at

`2026-06-07`

## Sprint history

| Sprint | Status | Completed at | Warmdown |
|--------|--------|--------------|----------|
| 0 | ✅ complete | 2026-06-07 | [sprint-0/WARMDOWN.md](./sprint-0/WARMDOWN.md) |
| 1 | ✅ complete | 2026-06-07 | [sprint-1/WARMDOWN.md](./sprint-1/WARMDOWN.md) |
| 2 | not-started | — | — |

When a sprint completes, append a row here from `WARMDOWN.md`.

## Backlog deltas this project life

`(none — see WBS §4 for the standing backlog)`

## Open RFC amendments

- **§4.7 `plandesk connect` + `.plandesk/`** — added to the RFC this program (02-requirements-interfaces §4.7), folded into Sprint 5 / S5-01. Loose ends to fold during S5: RFC §7.4 skill stub superseded by §4.7.5; §8 C17 should reference `connect` + `.plandesk/` and list `packages/plandesk-cli/src/connect.ts`.

---

## How to use this file

- A new session reads this file **first** to know which sprint is active and which sections of which docs are load-bearing right now.
- The session running a sprint **does not edit this file mid-sprint**. Updates land at warm-down.
- At warm-down, the session updates: active sprint pointer, **build branch** (only if it changed), load-bearing reading for the next sprint, last-completed fields, sprint history table, backlog deltas, and any open RFC amendments.
