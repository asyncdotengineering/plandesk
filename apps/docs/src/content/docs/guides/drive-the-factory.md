---
title: Drive the factory
description: The human operator's guide — how to prompt the Curator skills, run the execution loop, and tune risk lanes so an agent works your board safely.
---

The factory does the typing; you set the scope and the safety. This guide is for the **human operator** driving Plan Desk from Claude Code (or Codex): how to prompt the Curator skills, run the execution loop, and use risk lanes to keep control — especially on a live codebase.

If you haven't set up a repo yet, start with [Plan & execute a project](/guides/plan-and-execute/). For the underlying format, see the [Factory reference](/reference/factory/).

## Three roles, one board

Everything moves work through the board. Three roles act on it:

| Role | Does | You interact by |
| --- | --- | --- |
| **Curator** (skills) | Turns ideas and raw signal into a plan on the board | prompting with the right vocabulary |
| **Factory** (execution) | Runs the loop — pull → work → prove → done — gated by lanes | releasing work and resolving gates |
| **You** (human) | Decide what's ready, what's approved, and what to steer | `scope → todo` release, comments, gate approvals |

The Curator plans, the Factory builds, you decide. `plandesk factory init` scaffolds both, plus the hooks that keep the board in sync across sessions.

## The Curator skills

Skills load automatically when your words match their description. You can also name one explicitly ("use the intake skill to…"). These ship with `factory init`:

| Skill | Say this | It produces |
| --- | --- | --- |
| **plan-writer** | "write an RFC / design doc for X", "spec this before we build" | a `Design:` document — a build contract: problem, requirements, design, alternatives, verification surface |
| **intake** | "plan X into Plan Desk", "scaffold a project from this", "turn this into tasks" | the board itself — tasks + dependency edges + a Design doc, in one `scaffold_project_from_plan` call |
| **triage** | "triage the backlog", "sort this brain-dump into tasks", "groom the submissions" | deduped `scope` tasks, each with recorded provenance |
| **autonomy** | "run the board unattended", "work the board autonomously" | the lane-gated autonomous execution loop |
| **provenance / automation** | (mostly automatic) "why does this task exist", "run triage on a schedule" | evidence records / scheduled, event-driven triage |

They form a pipeline: **plan-writer** (write the RFC) → **intake** (RFC → board) → *you release* → **factory** (execute). You rarely need all of it — for a clear idea, go straight to intake.

## How to prompt effectively

The factory's posture is already loaded from `CLAUDE.md`, so you don't re-explain the process each time. Your leverage is **scope and safety**, not verbosity.

1. **Name the outcome, the artifact, and the boundary.** Not "improve checkout" — *"scaffold the checkout-revamp stories into the board as `scope` tasks, one per story, with dependency edges; do not release to `todo`."*
2. **Control scope explicitly:**
   - `"scope only — plan it, don't execute"`
   - `"analysis only — don't edit files"`
   - `"implement the first milestone only; don't touch the schema or payments"`
3. **Set the gate in the prompt:** *"create everything in `scope`, assign a lane by blast radius, then stop"* preserves the human release.
4. **Steer with comments, not re-prompts.** Comment on a doc or task in the UI; the agent pulls `list_comments`, addresses it, and `resolve_comment`s. This beats re-typing the brief.
5. **Let the loop run once released.** A clean goal plus the boundary is enough — over-instructing fights the skill.

**Bad → good:**

- "Can you look at the checkout and maybe start fixing things?"
- "Pull `get_next_task`, work only `todo` tasks in the checkout goal, stop at any `approve`/`full` task for me, and comment a diff summary before each."

## Running the execution loop

Per work item the agent runs one cycle — **pull → read spec → red gate → act → prove → observe the diff → lane gate → done, one commit** — then pulls the next. You choose how much runs unattended:

| Mode | How | When |
| --- | --- | --- |
| **Manual** | release one task, direct it, review, repeat | a new or untrusted repo, or live production |
| **Released-batch** | release a small `scope → todo` batch, let it loop, gated by lanes | the default sweet spot |
| **Full autonomous** | "work the board autonomously" (the autonomy skill) | a trusted repo with tight lanes |

Two levers are yours: the **`scope → todo` release** (what is allowed to start) and the **lanes** (what needs your sign-off). Tighten the lanes and wider autonomy becomes safe.

## Lanes — the throttle you own

Every task carries a **risk lane**, assigned at intake by blast radius. The lane decides how much human involvement its completion requires. Lanes live in `.agents/factory/lanes.md` — a committed, editable policy file you control:

| lane | applies to | gate |
| --- | --- | --- |
| **auto** | isolated, low-blast-radius changes (copy, docs, tests) | proof + verifiers only — no human |
| **approve** | routine feature work | diff summary posted as a comment; a human resolves it |
| **full** | schema, infra, auth, public contracts, anything touching production data | independent review + human approval |

How to use them:

- **Assign at intake.** When you scaffold, ask for lanes by blast radius: *"assign each task a lane from `.agents/factory/lanes.md`."* The lane is recorded in the task description.
- **Tune the table for your repo.** On a live or high-stakes codebase, widen `full` to cover everything risky — migrations, payment or checkout flows, auth, deploys, customer-data writes — and keep `auto` to genuinely safe work behind a flag. It's a plain Markdown table; edit it and commit.
- **Loosen deliberately, with evidence.** The default posture is conservative on purpose. Only move a category to a looser lane once the run history justifies it — and note why, so the next operator sees the reasoning.
- **The releaser owns the outcome.** Whoever releases `scope → todo` or approves a `full` gate owns the result. Lanes make that ownership explicit rather than implicit.

The pairing is the whole game: **tight lanes + small releases** on day one; widen both as you watch clean cycles land.

## A worked example

```
1. "Read the design brief and use intake to scaffold a project: a task per
    milestone, dependency edges between them, a Design: spec on the first task,
    and a lane per task by blast radius. Create everything in scope — don't
    release."                                        ← Curator / intake
2.  (review the graph on the Flow canvas, tighten lanes or edges)   ← You
3. "Release the first milestone to todo."            ← You (the release gate)
4. "Work the released tasks. Stop at every approve/full lane and post a diff
    summary comment first."                          ← Factory, you holding gates
5.  (comment on a spec to redirect a task)           ← You steer
```

## Cheat-sheet

| To… | Prompt with… |
| --- | --- |
| Think before building | "write an RFC for X" (plan-writer) |
| Put a plan on the board | "scaffold X into Plan Desk, scope only" (intake) |
| Clean up a messy backlog | "triage these into tasks" (triage) |
| Start execution | release `scope → todo`, then "work the released tasks" |
| Keep control on production | tighten `lanes.md`, release small batches |
| Redirect mid-flight | comment on the task or doc (not a re-prompt) |

The meta-skill: **you plan through the Curator, gate through lanes and releases, and steer through comments — the Factory does the typing.** Your words set scope and safety; the board carries the rest.
