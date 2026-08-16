---
title: Drive the factory
description: The human operator's guide — how to prompt the planning skills, run the execution loop, and tune risk lanes so an agent works your board safely.
---

The factory does the typing; you set the scope and the safety. This guide is for the **human operator** driving Plan Desk from Claude Code (or Codex): how to prompt the planning skills, run the execution loop, and use risk lanes to keep control — especially on a live codebase.

If you haven't set up a repo yet, start with [Plan & execute a project](/guides/plan-and-execute/). For the underlying format, see the [Factory reference](/reference/factory/).

## Three roles, one board

Everything moves work through the board. Three roles act on it:

| Role                    | Does                                                        | You interact by                                  |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| **Planning** (skills)   | Turns ideas and raw signal into a plan on the board         | prompting with the right vocabulary              |
| **Factory** (execution) | Runs the loop — pull → work → prove → done — gated by lanes | releasing work and resolving gates               |
| **You** (human)         | Decide what's ready, what's approved, and what to steer     | `scope → todo` release, comments, gate approvals |

Planning fills the board, execution empties it, you decide what moves between. `plandesk factory init` scaffolds both, plus the hooks that keep the board in sync across sessions.

## The skills

`factory init` installs these into `.agents/skills/` and symlinks them for your agent. Each one fires either when your words match its description, or when you invoke it directly as a slash command.

Everything is `plandesk-*`. Four do work; two are postures you chain onto the others.

| Skill                    | Invoke                            | Or just say                                                           | It produces                                                                                                          |
| ------------------------ | --------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **plandesk-plan-writer** | `/plandesk-plan-writer <feature>` | "write an RFC for X", "spec this before we build"                     | a `Design:` document — a build contract: problem, requirements, design, alternatives, verification surface           |
| **plandesk-scope-work**  | `/plandesk-scope-work backlog`    | "triage the backlog", "plan X into Plan Desk", "sort this brain-dump" | `scope` tasks with provenance — or a whole WBS with edges and a Design doc, in one `scaffold_project_from_plan` call |
| **plandesk-groom-task**  | `/plandesk-groom-task <task-id>`  | "groom this task", "this ticket is too thin", "we need X"             | one task rewritten in place to a build contract, plus its lane and edges                                             |
| **plandesk-foreman**     | `/plandesk-foreman all todo`      | "work the board", "ship the next task"                                | committed work — the execution half                                                                                  |

The two postures wrap the others rather than doing work themselves:

| Posture               | Chain it like                                   | What it changes                                                              |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| **plandesk-autonomy** | `/plandesk-autonomy /plandesk-foreman all todo` | removes the pause between steps; the lane gates still stop it                |
| **plandesk-timebox**  | `/plandesk-timebox 25m /plandesk-foreman next`  | adds a fixed interval and a checkpoint report, so a long run never goes dark |

They stack: `/plandesk-autonomy /plandesk-timebox 25m /plandesk-foreman next` runs unattended _and_ reports every 25 minutes. Neither grants a permission the wrapped skill didn't already have.

The pipeline: **plan-writer** (write the RFC) → **scope-work** (RFC → board) → _you release `scope` → `todo`_ → **foreman** (build it). You rarely need all of it — for a clear idea, go straight to scope-work.

For a single ad-hoc requirement there is no pipeline at all: **plandesk-groom-task** is the whole path. `/plandesk-groom-task <task-id>` takes a one-liner already on the board and rewrites it into something a worker can build; `/plandesk-groom-task "we need X"` creates the task first, then grooms it. It never changes status, so making a task buildable and deciding to build it stay two separate calls — yours. Run `/plandesk-groom-task all scope` before a release to see which tasks are actually ready.

## How to prompt effectively

The factory's posture is already loaded from `CLAUDE.md`, so you don't re-explain the process each time. Your leverage is **scope and safety**, not verbosity.

1. **Name the outcome, the artifact, and the boundary.** Not "improve checkout" — _"scaffold the checkout-revamp stories into the board as `scope` tasks, one per story, with dependency edges; do not release to `todo`."_
2. **Control scope explicitly:**
   - `"scope only — plan it, don't execute"`
   - `"analysis only — don't edit files"`
   - `"implement the first milestone only; don't touch the schema or payments"`
3. **Set the gate in the prompt:** _"create everything in `scope`, assign a lane by blast radius, then stop"_ preserves the human release.
4. **Steer with comments, not re-prompts.** Comment on a doc or task in the UI; the agent pulls `list_comments`, addresses it, and `resolve_comment`s. This beats re-typing the brief.
5. **Let the loop run once released.** A clean goal plus the boundary is enough — over-instructing fights the skill.

**Bad → good:**

- "Can you look at the checkout and maybe start fixing things?"
- "Pull `get_next_task`, work only `todo` tasks in the checkout goal, stop at any `approve`/`full` task for me, and comment a diff summary before each."

## Running the execution loop

`/plandesk-foreman` runs the loop. Give it a scope and it takes board work to committed:

```bash
/plandesk-foreman <task-id>      # one item
/plandesk-foreman next           # whatever get_next_task returns
/plandesk-foreman all todo       # the whole unblocked frontier
/plandesk-foreman next --to pi   # pin the worker instead of routing
```

Per work item it runs one cycle — **preflight → read spec → groom → red gate → dispatch → stage → verify → commit → review → lane gate** — then takes the next. It grooms inline and only dispatches implementation: grooming is judgment about what you actually meant, and handing that to a worker is how a plan drifts.

You choose how much runs unattended:

| Mode                | How                                                                                 | When                                            |
| ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Manual**          | release one task, `/plandesk-foreman <task-id>`, review, repeat                     | a new or untrusted repo, or live production     |
| **Released-batch**  | release a small `scope → todo` batch, then `/plandesk-foreman all todo`             | the default sweet spot                          |
| **Full autonomous** | wide release plus tight lanes, then `/plandesk-autonomy /plandesk-foreman all todo` | a trusted repo where the lanes carry the safety |

Two levers are yours: the **`scope → todo` release** (what is allowed to start) and the **lanes** (what needs your sign-off). Tighten the lanes and wider autonomy becomes safe.

## Lanes — the throttle you own

Every task carries a **risk lane**, assigned at intake by blast radius. The lane decides how much human involvement its completion requires. Lanes live in `.agents/factory/lanes.md` — a committed, editable policy file you control:

| lane        | applies to                                                               | gate                                                  |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| **auto**    | isolated, low-blast-radius changes (copy, docs, tests)                   | proof + verifiers only — no human                     |
| **approve** | routine feature work                                                     | diff summary posted as a comment; a human resolves it |
| **full**    | schema, infra, auth, public contracts, anything touching production data | independent review + human approval                   |

How to use them:

- **Assign at intake.** When you scaffold, ask for lanes by blast radius: _"assign each task a lane from `.agents/factory/lanes.md`."_ The lane is recorded in the task description.
- **Tune the table for your repo.** On a live or high-stakes codebase, widen `full` to cover everything risky — migrations, payment or checkout flows, auth, deploys, customer-data writes — and keep `auto` to genuinely safe work behind a flag. It's a plain Markdown table; edit it and commit.
- **Loosen deliberately, with evidence.** The default posture is conservative on purpose. Only move a category to a looser lane once the run history justifies it — and note why, so the next operator sees the reasoning.
- **The releaser owns the outcome.** Whoever releases `scope → todo` or approves a `full` gate owns the result. Lanes make that ownership explicit rather than implicit.

The pairing is the whole game: **tight lanes + small releases** on day one; widen both as you watch clean cycles land.

## A worked example

```
1. "Read the design brief and use scope-work to scaffold a project: a task per
    milestone, dependency edges between them, a Design: spec on the first task,
    and a lane per task by blast radius. Create everything in scope — don't
    release."                                        ← plandesk-scope-work
2.  (review the graph on the Flow canvas, tighten lanes or edges)   ← You
3. "Release the first milestone to todo."            ← You (the release gate)
4. "Work the released tasks. Stop at every approve/full lane and post a diff
    summary comment first."                          ← Factory, you holding gates
5.  (comment on a spec to redirect a task)           ← You steer
```

## Cheat-sheet

| To…                               | Run…                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Think before building             | `/plandesk-plan-writer <feature>`                                                           |
| Put a plan on the board           | `/plandesk-scope-work <idea or RFC>` — add "scope only" to hold the release                 |
| Clean up a messy backlog          | `/plandesk-scope-work backlog`                                                              |
| Make one thin task buildable      | `/plandesk-groom-task <task-id>` — or `/plandesk-groom-task "we need X"` to create it first |
| Check a batch before releasing it | `/plandesk-groom-task all scope`                                                            |
| Start execution                   | release `scope → todo`, then `/plandesk-foreman all todo`                                   |
| Ship one specific task            | `/plandesk-foreman <task-id>`                                                               |
| Run a batch without babysitting   | `/plandesk-autonomy /plandesk-foreman all todo`                                             |
| Grind a long list with check-ins  | `/plandesk-timebox 25m /plandesk-foreman next`                                              |
| Keep control on production        | tighten `lanes.md`, release small batches                                                   |
| Redirect mid-flight               | comment on the task or doc (not a re-prompt)                                                |

The meta-skill: **you plan through the planning skills, gate through lanes and releases, and steer through comments — the foreman and its workers do the typing.** Your words set scope and safety; the board carries the rest.
