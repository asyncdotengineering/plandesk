# Project State

> **Single source of truth for "where are we right now."** Updated at the end of every sprint warm-down.

---

## Active sprint

**Sprint number:** `6`
**Sprint name:** Polish + 1.0
**Status:** `not-started`
**Goal:** Every §9 fail-to-pass test and validation command is green, the v1 measurable-outcome metrics (cold start <5 s, MCP list/inspect <2 s p95, SSE <500 ms, lossless export) are measured and met, and the repo ships a 1.0 tag with full setup docs.
**WBS section:** [`sprints/WBS.md` § Sprint 6](./WBS.md)

## Build branch

**Active build branch:** `main`

Every sprint session — manager and IC — works **on this branch only**. This is a fresh local repo with no trunk/PR model; the user asked for atomic commits per round on the local repo, so `main` is explicitly the build branch. Before Step 1 of the kickoff, confirm `git branch --show-current` matches. All story commits (`[S{N}-{nn}]`), fix-pass (`[S{N}-fix]`), and closeout (`[S{N}-close]`) land here.

At session start: `git checkout main`.

## Load-bearing reading for sprint 6

The session running sprint 6 must read these in this order before delegating any story:

1. `sprints/sprint-5/HANDOFF.md` — **read first**; feature-complete + distributable; S6 = validation/metrics/docs/1.0.
2. `sprints/WBS.md` § Sprint 6 + § 1.2 DoD.
3. `sprints/SESSION_KICKOFF_PROMPT.md` — the loop you are running.
4. `../plandesk-rfc/04-tasks-validation.md` — §9 (validation contract + fail-to-pass tests + §9.3 commands).
5. `../plandesk-rfc/01-problem-background.md` — §1 (measurable-outcome targets).
6. `../plandesk-rfc/05-security-rollback-open-qs.md` — §10 (threat-model checklist).

## Last completed sprint

`5 — Distribution + integration + dogfood`

## Last completed at

`2026-06-08`

## Sprint history

| Sprint | Status | Completed at | Warmdown |
|--------|--------|--------------|----------|
| 0 | ✅ complete | 2026-06-07 | [sprint-0/WARMDOWN.md](./sprint-0/WARMDOWN.md) |
| 1 | ✅ complete | 2026-06-07 | [sprint-1/WARMDOWN.md](./sprint-1/WARMDOWN.md) |
| 2 | ✅ complete | 2026-06-07 | [sprint-2/WARMDOWN.md](./sprint-2/WARMDOWN.md) |
| 3 | ✅ complete | 2026-06-07 | [sprint-3/WARMDOWN.md](./sprint-3/WARMDOWN.md) |
| 4 | ✅ complete | 2026-06-08 | [sprint-4/WARMDOWN.md](./sprint-4/WARMDOWN.md) |
| 5 | ✅ complete | 2026-06-08 | [sprint-5/WARMDOWN.md](./sprint-5/WARMDOWN.md) |
| 6 | not-started | — | — |

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
