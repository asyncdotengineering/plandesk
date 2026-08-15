---
title: How the factory works
description: The cycle that turns one released task into one verified commit, and the skills that drive it.
---

The board holds the plan. The factory does the work.

The factory is a contract. It turns one released task into one verified commit. It says
who does each step, what proof is necessary, and where a person must agree before the work
continues.

This page explains the model. For the file format and the command flags, read
[Factory workspace](/reference/factory/).

## Three roles

The factory has three roles. Each role does work that the other two must not do.

| Role           | Who it is                            | What it does                                           |
| -------------- | ------------------------------------ | ------------------------------------------------------ |
| **Human**      | You, on the board                    | Releases work, clears gates, and merges the result.    |
| **Supervisor** | Your agent session                   | Reads the plan, writes the brief, and proves the work. |
| **Worker**     | A command-line agent on your machine | Makes the change and reports what it ran.              |

The supervisor does not write the code. The worker does not decide if the work is
acceptable. The human does not read every diff, but the human owns every merge.

## The work cycle

The supervisor does one work item at a time. Each item follows the same eight steps.

1. **Pull.** Call `get_next_task`. Only released tasks with completed prerequisites appear.
2. **Read.** Read the specification document linked to the task.
3. **Red gate.** Run the check that must fail. A check that passes now proves nothing.
4. **Delegate.** Select a worker, write a brief, and start the worker.
5. **Prove.** Run the commands the worker says it ran. The exit codes decide.
6. **Observe.** Read the diff. Do not read the worker's summary instead of the diff.
7. **Gate.** Apply the risk lane of the task. See _Risk lanes_ below.
8. **Ship.** Set the task to `done`, write one metrics line, and commit that one item.

The supervisor repeats the cycle until no task remains. One work item gives one commit.
The commit subject names the task. The board and the history therefore stay in agreement.

### Why the red gate is step 3

A check that already passes cannot show that the work succeeded. The supervisor must see
the check fail first. If the check passes before any work starts, the task returns to
`scope` with a comment. This step stops the most common false result in agent work.

## Proof replaces trust

A worker reports its result in a file. The file has three fields.

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "pnpm test", "exit_code": 0 }],
  "question": "only when blocked: what decision is necessary"
}
```

A claim is a command the worker says it ran. The supervisor runs each claim again. The
exit code is the authority.

Two results are failures, not successes:

- A `done` status with no claims. The worker gave no evidence.
- A claim that does not repeat. The evidence is false.

No worker grades its own work. The text a worker writes is a report, not a fact.

## Risk lanes

Each task carries a lane. The lane states how much a person must do before the work
continues.

| Lane      | Applies to                                               | Gate                                                    |
| --------- | -------------------------------------------------------- | ------------------------------------------------------- |
| `auto`    | Small, isolated changes such as copy and docs            | Proof and verifiers only. No person.                    |
| `approve` | Usual feature work                                       | The supervisor posts a diff summary. Someone clears it. |
| `full`    | Schema, infrastructure, authentication, public contracts | An independent review, then someone clears it.          |

A task with no lane is `approve`. It is never `auto`. A simple task is not an unguarded
task.

A `full` lane review must come from a different model family than the author. The routing
policy pins each worker to a model, so the supervisor can prove the reviewer is
independent.

Under [plandesk-autonomy](#the-skills), the agent may clear a gate itself. It must first
post its reasoning as a comment on the board. That comment is your override. You can
reverse the decision, reopen the task, or revert the commit.

## Workers

A worker is a command-line agent on your machine. The factory ships six worker files:
`claude`, `codex`, `cursor`, `grok`, `opencode`, and `pi`.

Each worker file holds two things:

- A **probe** command. It exits 0 only if that worker is installed here.
- A **command** template. The supervisor puts the brief path into it and runs it.

The supervisor probes before it dispatches. It never sends work to a worker that is absent.
Your repository policy therefore travels to a machine with a different set of tools.

The routing policy selects the worker by the shape of the task. Mechanical work goes to the
cheapest worker that probes. Work that needs taste goes to the strongest worker. Reviews go
to a different family than the author.

## The skills

The policy files say how a cycle runs. The skills run one. `plandesk factory init` installs
nine skills into `.agents/skills/`.

Four skills put work onto the board:

| Skill                  | What it does                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| `plandesk-plan-writer` | Writes the reasoning first, as a design document or a decision record. |
| `plandesk-scope-work`  | Turns raw signal or one idea into `scope` tasks, edges, and lanes.     |
| `plandesk-groom-task`  | Rewrites one thin task into a build contract a worker can execute.     |
| `plandesk-prototype`   | Writes click-through HTML screens for review before the build.         |

One skill runs the board:

| Skill              | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `plandesk-foreman` | Takes one task, or the whole unblocked frontier, from board to commit. |

Two skills change how a run is paced. You chain them in front of another skill. They add no
new permission.

| Skill               | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `plandesk-autonomy` | Removes the pause between steps. The risk lanes still stop the run. |
| `plandesk-timebox`  | Divides a long run into intervals and reports at each boundary.     |

Two skills carry context between sessions:

| Skill                | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `plandesk-standup`   | Rebuilds context at the start of a session.          |
| `plandesk-standdown` | Writes what shipped, what blocked, and what is left. |

Chain the postures in front of the skill that does the work:

```bash
/plandesk-foreman next                                   # one task
/plandesk-foreman all todo                               # the unblocked frontier
/plandesk-autonomy /plandesk-foreman all todo            # no pause between items
/plandesk-timebox 25m /plandesk-foreman next             # a report every 25 minutes
```

### The skills do not repeat the policy

Each rule has one home. The foreman links the cycle contract. It does not copy it. Three
skills must decide if a task is buildable, and all three read one table in
`plandesk-groom-task`.

A second copy of a rule becomes a second authority. Two authorities then disagree.

## What a person still owns

The factory moves work. It does not take the decisions.

- **Release.** A task moves from `scope` to `todo` because a person moves it. `get_next_task`
  never returns unreleased work.
- **Gates.** The `approve` and `full` lanes need a gate resolution. Every resolution is a
  comment. You can read it and reverse it.
- **Merge.** Nothing reaches a protected branch without you.

## Start the factory

```bash
plandesk factory init      # install .agents/ into this repository
plandesk factory sync      # show what a newer version would change
```

`init` writes the policy files once. It never overwrites a file you edited. The files are
yours after that. Commit them with the code they govern.

## Related

- [Factory workspace](/reference/factory/) — the file format, the frontmatter, and the flags
- [Drive the factory](/guides/drive-the-factory/) — a worked run, step by step
- [Goals](/reference/goals/) — the contract above the tasks, and how completion is proved
