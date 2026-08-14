---
title: Goals
description: Durable contracts you hand to an agent — objective, verification surface, and the evidence that closes them.
---

A **Goal** is the contract layer above tasks. A task says what to change; a Goal says
what "finished" means and how it will be proved. The Goals screen describes itself the
same way: _durable contracts you hand to agents — open one to watch it get built, and act
where a gate needs you._

Every task belongs to a Goal (`tasks.goal_id` is `NOT NULL`). A new project gets a
default Goal named **General**, and task-creation surfaces attach to it unless you pass a
`goal_id`.

## Why a Goal and not just a task list

A task list tells an agent what to do next. It does not tell the agent when to stop, what
it may not touch, or who decides the work is acceptable. Without those, a long unattended
run either stops too early or keeps going past the point anyone wanted.

A Goal carries the four things a task cannot:

- **A verification surface** — the check that decides acceptance, declared up front.
- **A stop condition** — the sentence that ends the run.
- **Constraints and boundaries** — what must not change, and what is out of scope.
- **An acceptance status** — whether the evidence has been recorded yet.

## Fields

| Field                  | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `objective`            | Required. What this Goal is for, in prose.                                |
| `name`                 | Optional, unique per project. Lets you address the Goal by name.          |
| `status`               | `active`, `paused`, `complete`, or `blocked`.                             |
| `verification_surface` | How completion is proved. See below. Omit for a Goal with no formal gate. |
| `constraints`          | What the work must not do — systems to leave alone, invariants to hold.   |
| `boundaries`           | What is in and out of scope, and where out-of-scope work lands instead.   |
| `stop_condition`       | The sentence that ends the run.                                           |
| `iteration_policy`     | How many attempts, and what to do when one fails.                         |
| `budget`               | The spend or time ceiling for the Goal.                                   |
| `last_verification`    | The most recent evidence recorded against the Goal.                       |

## Verification surfaces

A verification surface is declared when the Goal is created or updated, and the evidence
passed to `complete_goal` must match its kind. The server validates the evidence against
the declaration — it never runs a shell command itself.

| Surface                                                       | Evidence that closes it                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `{"kind":"gate_command","command":"pnpm build && pnpm test"}` | `{"kind":"gate_command","exit_code":0}`                                    |
| `{"kind":"acceptance_checklist","items":[{"criterion":"…"}]}` | `{"kind":"acceptance_checklist","checked":["item id or exact criterion"]}` |
| `{"kind":"human_sign_off"}`                                   | `{"kind":"human_sign_off","approved_by":"…"}`                              |

The server returns stable item ids for checklist items, so evidence can reference an id
instead of repeating the criterion text.

## Lifecycle

```jsonc
create_goal({ project_id, objective, name: "client-2026-08", verification_surface })
invoke_goal({ goal_id })        // sets current_goal_id, checks for cycles,
                                // returns the first frontier todo
get_next_task({ project_id })   // walks that Goal's frontier
complete_goal({ goal_id, evidence })
```

`pause_goal` and `resume_goal` move a Goal in and out of `paused`. `set_current_goal`
points the project's `current_goal_id` at an active Goal, so `get_next_task` resolves
there when `goal_id` is omitted.

When several Goals are active and none is current, `get_next_task` cannot choose and says
so rather than guessing.

## Completion is refused, not assumed

`complete_goal` fails closed. Four refusals are worth knowing:

| Error                            | Meaning                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `verification_required`          | The Goal declares a surface and no evidence was supplied.         |
| `blocked_by_incomplete_tasks`    | Cycle tasks are still open.                                       |
| `invalid_argument` + `unmatched` | Checklist evidence names criteria that do not exist on this Goal. |
| `invalid_argument` + `unmet`     | Checklist evidence leaves declared criteria unchecked.            |

`invoke_goal` refuses too: it returns `no_todo_tasks` when every task is still in `scope`.
Releasing `scope` to `todo` is a human decision, and no tool self-releases it.

## Working a Goal with an agent

The [Factory contract](/reference/factory/) drives Goals as the unit of unattended work:
the runner takes cycle tasks to `done`, runs the declared verification surface externally,
and calls `complete_goal` with the result.

Green evidence completes the Goal. Red evidence sets it `blocked` and files a `scope`
remediation task named `Fix acceptance failure: <objective>` — one at a time, so a Goal
that fails twice does not accumulate duplicate cards. A failed gate leaves work on the
board rather than a silent stop.

## Related

- [Factory](/reference/factory/) — the execution loop and risk lanes that run a Goal
- [REST + MCP API](/reference/api/) — every goal tool and endpoint
- [Drive the factory](/guides/drive-the-factory/) — running the loop end to end
