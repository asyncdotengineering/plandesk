# Project State

> **Single source of truth for "where are we right now."** Updated at the end of every sprint warm-down.

---

## Active sprint

**Sprint number:** `0`
**Sprint name:** Foundations
**Status:** `not-started`
**Goal:** `pnpm build` is green and `plandesk serve` binds `127.0.0.1:3847` serving `GET /api/v1/health → {ok:true}` against a migrated SQLite workspace with all RFC §4.4 tables.
**WBS section:** [`sprints/WBS.md` § Sprint 0](./WBS.md)

## Build branch

**Active build branch:** `main`

Every sprint session — manager and IC — works **on this branch only**. This is a fresh local repo with no trunk/PR model; the user asked for atomic commits per round on the local repo, so `main` is explicitly the build branch. Before Step 1 of the kickoff, confirm `git branch --show-current` matches. All story commits (`[S{N}-{nn}]`), fix-pass (`[S{N}-fix]`), and closeout (`[S{N}-close]`) land here.

At session start: `git checkout main`.

## Load-bearing reading for sprint 0

The session running sprint 0 must read these in this order before delegating any story:

1. `sprints/WBS.md` — full read; this is the plan.
2. `sprints/SESSION_KICKOFF_PROMPT.md` — the loop you are running.
3. `../plandesk-rfc/README.md` — RFC index + guiding principles + ship sequence.
4. `../plandesk-rfc/02-requirements-interfaces.md` — §3 requirements, §4 interfaces (REST/MCP/CLI/data model/frontend/§4.7 connect), §5 architecture. **Load-bearing for S0:** §4.4 (data model), §5.1 (monorepo layout), §4.1 (CLI).
5. `../plandesk-rfc/03-pseudocode-blueprint.md` — §6.1 (server boot), §7 code blueprint.
6. `../plandesk-rfc/04-tasks-validation.md` — §8 C1/C2 chunk grounding, §9 validation.

## Last completed sprint

`(none — project not started)`

## Last completed at

`(none)`

## Sprint history

| Sprint | Status | Completed at | Warmdown |
|--------|--------|--------------|----------|
| 0 | not-started | — | — |

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
