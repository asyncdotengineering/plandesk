---
title: Factory workspace
description: The project-local .agents/ factory format — portable, file-based agent policy that Plan Desk scaffolds and any harness can consume.
---

:::note
This page is the **format reference** — the files, their frontmatter, and the command
flags. For the model behind it — the roles, the work cycle, the risk lanes, and the
skills — read [How the factory works](/reference/how-the-factory-works/).
:::

`plandesk factory init` scaffolds a **project-local agent factory workspace**: a small tree of markdown policy files under `.agents/` that defines how delegated agent work runs in this repository — the work cycle, the worker roster, the risk lanes, and the per-change verifiers. Plan Desk is the scheduler (the board); these files are the policy.

The format is deliberately harness-neutral. Claude Code consumes it today through a thin command adapter; any other runtime (Codex, a workflow engine like Mastra, your own orchestrator) can consume the same files, because the format follows conventions that are converging across the ecosystem: path-derived identity, markdown with minimal frontmatter, and permissive consumers.

## Why project-local

Agent config written into global directories (`~/.claude`, `~/.codex`) leaks into every project on the machine — a `CLAUDE.md` include there loads in every session everywhere. The factory workspace therefore always lives **in the repository**, versioned with the code it governs. Both `plandesk factory init` and `plandesk connect` refuse to write into your home directory or a global config directory (`factory init --force` overrides, if you really mean it).

## The scaffold

```
.agents/
├─ index.md                    # progressive disclosure: what lives here (sentinel block)
├─ skills/                     # nine invocable skills — all `plandesk-*`
│  ├─ plandesk-plan-writer/    #   write the RFC before there is a board
│  ├─ plandesk-scope-work/     #   raw signal or a whole idea → scope tasks + edges
│  ├─ plandesk-groom-task/     #   thin task → build contract (owns the Definition of Ready)
│  ├─ plandesk-prototype/      #   click-through HTML screens for review before the build
│  ├─ plandesk-foreman/        #   runs the board floor (execution)
│  ├─ plandesk-autonomy/       #   chainable: run another skill unattended
│  ├─ plandesk-timebox/        #   chainable: pace a run in timeboxes
│  ├─ plandesk-standup/        #   rebuild context at the start of a session
│  └─ plandesk-standdown/      #   what shipped, what blocked, what is left
└─ factory/
   ├─ factory.md               # the contract: how a work cycle runs (type: factory)
   ├─ execution.md             # IC spine: decompose, drive to zero, ship (type: execution)
   ├─ workmanship.md           # the bar a dispatched worker's output must meet
   ├─ slicing.md               # optional: cut a wide frontier into tracer-bullet slices
   ├─ brief.md                 # optional: multi-slice dispatch + worktree notes
   ├─ heartbeat.md             # optional: stall fallback for long multi-slice runs
   ├─ protocol.md              # deterministic dispatch + result contract (type: protocol)
   ├─ routing.md               # which worker for which task shape
   ├─ workers/                 # one file per worker CLI (type: worker)
   │  ├─ claude.md             #   probe + command template with {prompt_file}
   │  ├─ codex.md
   │  ├─ cursor.md
   │  ├─ grok.md
   │  ├─ opencode.md
   │  └─ pi.md
   ├─ lanes.md                 # risk lanes: which changes need which human gates (type: lanes)
   ├─ verifiers/
   │  └─ tests-pass.md         # example per-change check (type: verifier)
   └─ runs/                    # transient machine state — gitignored
.claude/skills/<name>/         # symlinks to .agents/skills/ — one per skill
.claude/commands/factory.md    # generated adapter: /factory loads the contract
.codex/commands/factory.md     # generated adapter (when a .codex/ setup is detected)
```

Two zones with different ownership:

- **Authored policy** (`factory.md`, `execution.md`, companions, `protocol.md`, `routing.md`, `workers/*`, `lanes.md`, `verifiers/*`) — scaffolded **once**, then yours. Re-running `factory init` never overwrites them (`skip` in the summary). Edit them, commit them; they are the repository's operating policy. `index.md` is a shared-file sentinel block, not a whole-file artifact.
- **Generated adapters** (`.claude/commands/factory.md`, `.codex/commands/factory.md`) — one-line includes, refreshed on every run.
- **Transient state** (`factory/runs/`) — machine output such as `metrics.jsonl`; gitignored by the scaffold.

## Format rules

The format is small on purpose; it borrows the conformance posture of the Open Knowledge Format and the Agent Skills spec:

1. **One required frontmatter field.** Every policy file declares a `type` (`factory`, `execution`, `protocol`, `worker`, `lanes`, `verifier`). Everything else is optional.
2. **Identity is the path.** A file's name is its name — no `id` fields, no registry. `verifiers/tests-pass.md` _is_ the verifier `tests-pass`.
3. **Consumers are permissive.** Tools reading `.agents/` MUST tolerate unknown types, unknown frontmatter keys, and links to files that do not exist yet. Old consumers never break on new producers — this is what lets one repo serve Claude Code today and a hosted orchestrator later without changing a file.
4. **Markdown is the interchange layer.** Guidance (contracts, rosters, policy) lives in markdown and ports across harnesses. Anything executable a specific runtime needs is compiled _from_ these files, never written back into them.

## Workers and the dispatch protocol

Dispatch is deterministic — data the engine evaluates, not prose a model re-interprets each run. Each file under `workers/` declares a worker CLI:

```markdown
---
type: worker
probe: command -v codex
command: codex exec --full-auto < {prompt_file}
---
```

- **`probe`** — exits 0 only if this worker is installed on this machine. The scaffold is portable: it never assumes a CLI exists; the supervisor probes at dispatch time and routes only to available workers.
- **`command`** — an invocation template. The supervisor substitutes `{prompt_file}` with the brief path and runs it verbatim; flags are never re-derived from memory. Edit the template once per repo/machine as versions change.

`protocol.md` defines the rest of the contract: briefs are written to `runs/brief-<task>.md`; the worker ends by writing `runs/result-<task>.json` (`status`, `claims` of commands run with exit codes, optional blocking `question`); the engine **re-runs the claimed commands** and treats exit codes as authoritative. A `done` with no claims — or a claim that doesn't reproduce — is a failed dispatch. Model output is metadata; no worker grades its own work.

## Running the board: `/plandesk-foreman`

The files above are policy — they describe how a cycle runs. `plandesk-foreman` is what _runs_ one. Give it a scope and it takes board work to committed:

```bash
/plandesk-foreman <task-id>     # one item
/plandesk-foreman next          # whatever get_next_task returns
/plandesk-foreman all todo      # the whole unblocked frontier
/plandesk-foreman next --to pi  # pin the worker instead of routing
```

Its cycle: preflight (clean tree, no live dispatch, board reachable, a worker probe passes) → resolve the scope → groom → slice if the frontier is wide → dispatch → **stage before reviewing** → verify the claims → commit that item → review the diff → apply the lane → repeat.

Two of those deserve calling out, because both encode an incident:

- **Grooming stays inline; only implementation dispatches.** A task is ready when a worker with no session history could build it — stated outcome, context, constraints, testable acceptance criteria, and the commands that prove it. Anything short of that gets rewritten by the conductor, not shipped to a worker. Grooming is judgment about _intent_, and delegating that is how a plan drifts from what was actually wanted.
- **Staging happens before review, not after.** Review takes minutes and unstaged work is defenceless for all of them; staged work survives a stray `git checkout` because git restores it from the index.

The skill links the policy rather than restating it, which is deliberate: a second copy of the cycle is a second authority, and they drift.

## The bar for dispatched work: `workmanship.md`

`protocol.md` covers the engine verifying a worker _after_ a dispatch returns. `workmanship.md` is the other half — the standard prepended to every implementation brief, so a worker knows the bar before it starts rather than discovering it by failing verification.

It covers: no workarounds and never editing a gate's config to make the gate pass; never claiming done without proof; writing the test so it fails first; surgical changes; never destroying work it did not create; and honest reporting through the result contract.

It is self-contained on purpose. A consumer's machine has none of your personal instruction files, so everything a worker needs lives under `.agents/`. A brief that reaches outside `.agents/` for a contract is the bug.

## Planning skills — getting work onto the board

`plandesk-plan-writer` authors an RFC as a `Design:` document. `plandesk-scope-work` is the front door for everything that follows: handed a pile of existing items — submissions, an ungroomed backlog, a pasted brain-dump — it dedups them into `scope` tasks with recorded provenance; handed one idea, RFC, or PRD, it decomposes it into a whole WBS with edges, lanes, and a Design doc in a single atomic `scaffold_project_from_plan` call. `plandesk-groom-task` takes a single thin task, or a bare one-line requirement, and makes it buildable in place.

Across all of them, `scope → todo` stays human-only. Automation is not a route to a stronger autonomy grant.

### Two postures, chained onto the rest

`plandesk-autonomy` and `plandesk-timebox` do no work of their own — you chain them in front of a skill that does:

```bash
/plandesk-autonomy /plandesk-foreman all todo          # no pause between items
/plandesk-timebox 25m /plandesk-foreman next           # a checkpoint report every 25 minutes
/plandesk-autonomy /plandesk-timebox 25m /plandesk-foreman next   # both
```

Autonomy removes the pause between steps; timebox adds a rhythm and a report so a long run never goes dark. Neither widens what the wrapped skill is allowed to do — a wrapped `plandesk-groom-task` still cannot change a task's status, and every risk lane still stops the run cold.

### One Definition of Ready

Three skills need to answer "is this task buildable yet?" — scope-work when it drafts a task, groom-task when it rewrites one, the foreman before it dispatches one. That question is answered in exactly one place: the **Definition of Ready** table in `plandesk-groom-task`. The other two link to it rather than restating it, for the same reason the foreman links the cycle contract instead of copying it — a second copy is a second authority, and they drift.

The split with `.plandesk/skill.md` is deliberate: that file owns the _shape_ of a task description (which fields it carries, always loaded in default context), and `plandesk-groom-task` owns the _verdict_ (whether each field is good enough yet). Shape is a convention; readiness is a judgement with a gate behind it.

`plandesk-groom-task` is also the only entry point for an **ad-hoc** requirement. Scope-work drafts tasks only at creation time, from whatever the source material carried; the foreman grooms only as a prelude to dispatch. A one-liner someone drops on the board mid-week has no other route to becoming work: `/plandesk-groom-task <task-id>` rewrites it in place, and `/plandesk-groom-task "we need X"` creates the task first and then grooms it. It never changes status — making a task buildable and releasing it stay separate decisions.

## Installing more skills

Plan Desk does not ship a skill installer — use the open ecosystem's CLI, which installs Agent Skills into the same `.agents/skills/` root this scaffold uses (and per-agent adapters for 70+ agents, Claude Code's `.claude/skills/` included):

```bash
npx skills add <owner>/<repo> --skill <name>   # install into this project
npx skills find <keyword>                      # search skills.sh
npx skills update                              # pull newer versions
```

Skills are portable by format (SKILL.md directories); commit the installed copies so they travel with the repo. One gap to mind: the installer does not check machine dependencies — a skill whose scripts need e.g. `ffmpeg` installs fine on a machine that lacks it. Declare such needs in the skill's frontmatter and verify them before relying on the skill.

## Verifiers

A verifier is a fast, deterministic per-change check — one file per check under `factory/verifiers/`:

```markdown
---
type: verifier
command: pnpm test --silent
enabled: true
---

# Tests pass
```

`command` runs from the repo root; exit code 0 means pass. The scaffold ships one example (`enabled: false`) so nothing runs until you point it at this repo's real gate.

## Workflow at a glance

```
   HUMAN (board)          │        SUPERVISOR (agent session)      │   WORKER (IC)
══════════════════════════╪════════════════════════════════════════╪═══════════════════
                          │                                        │
  drag scope ──► todo     │                                        │
  ┌─────────────────┐     │                                        │
  │  RELEASE GATE   │═════╪══► 1. get_next_task ◄──────────────┐   │
  └─────────────────┘     │       (only unblocked todo;        │   │
                          │        scope is invisible)         │   │
                          │              ▼                     │   │
                          │    2. read linked spec doc         │   │
                          │              ▼                     │   │
                          │    3. RED GATE: run check          │   │
                          │       already green? ──────────────┼──► back to scope
                          │              │ red ✓               │   │  + comment
                          │              ▼                     │   │
                          │    4. probe workers/*.md           │   │
                          │       write runs/brief-<t>.md      │   │
                          │       run cmd template ════════════╪══►│ does the work
                          │              │                     │   │      ▼
                          │              │                 ◄═══╪═══│ runs/result-<t>.json
                          │              ▼                     │   │ {status, claims[]}
                          │    5. PROVE: re-run every claim    │   │
                          │       exit codes authoritative     │   │
                          │       claim fails? ────────────────┼──► dispatch failed
                          │              │ verified ✓          │   │
                          │              ▼                     │   │
                          │    6. OBSERVE: read the diff       │   │
                          │              ▼                     │   │
                          │    7. LANE GATE (lanes.md)         │   │
                          │      ┌───────┼────────────┐        │   │
                          │    auto   approve        full      │   │
  resolve diff comment ◄──╪──────┼──────┘              │       │   │
  ┌─────────────────┐     │      │              cross-family   │   │
  │  APPROVE GATE   │═════╪══►   │              review + human │   │
  └─────────────────┘     │      ▼                     ▼       │   │
                          │    8. update_task ──► done         │   │
                          │       append runs/metrics.jsonl    │   │
                          │              └── next cycle ───────┘   │
                          │                                        │
  ┌─────────────────┐     │    loop until nothing actionable       │
  │   MERGE GATE    │◄════╪═══  verified, reviewed branch          │
  │  human ships it │     │                                        │
  └─────────────────┘     │                                        │
```

Every human touchpoint is a board interaction (drag, resolve, merge), not a chat message. The worker column is stateless — a brief file in, a result file out — which is why any CLI on any machine can fill it. Both failure paths (green-at-start, unreproducible claim) route back through the board instead of dying silently in a session.

## Who can release work?

Releasing a task (`scope` → `todo`) works two ways today:

- **Humans** drag the card between columns on the Board view (five columns: Scope, Todo, In progress, Done, Backlog) — the drop issues the status change; connected agents' UIs pick it up on their next poll (~2.5s).
- **Agents** technically can call `update_task` with `status: "todo"` — the API does not restrict transitions. The enforcement in the current design is at _read_ time: `get_next_task` never returns unreleased work, and the factory contract instructs the supervisor to treat release as human-owned.

In other words: the release gate is mechanism-enforced for _pulling_ work and convention-enforced for _promoting_ it. If your policy needs hard human-only release (e.g. regulated repos), keep `update_task`-driven promotion out of your supervisor's contract — and watch the changelog: token-scoped transition rules are a candidate hardening.

## One contract, optional extensions

- **`factory.md` — the operating mode.** The proven serial loop (one work item at a time): pull → read → red gate → delegate → prove → observe → gate → ship, plus the agent-run lifecycle (`start_agent_run` / `record_agent_progress` / `complete_agent_run`) and goal completion via `verification_surface`. This is the always-on contract.
- **`execution.md` — the IC spine.** How to decompose and drive to zero when you (or a worker) are typing the work yourself. Referenced from the always-on preamble; not inlined every session.
- **`slicing.md` / `brief.md` / `heartbeat.md` — companions.** Real, documented extensions for multi-slice work (tracer bullets, worktrees, stall heartbeat). Linked from `factory.md` in one line; not the default.

**Policy is always-on; data is on-demand.** `factory init` manages its own include block in the repo's `CLAUDE.md` (and `AGENTS.md` when present) loading only `factory.md` — policy must ride in default context to gate behavior; a pointer an agent may not follow is not a gate. Dispatch data (`protocol.md`, `workers/`, `lanes.md`, `verifiers/`) stays on-demand, read at dispatch and gate time. The `/factory` command re-loads `factory.md` + `execution.md` explicitly.

## The cycle

`factory.md` documents the full loop; in short, a supervising agent session works the bound Plan Desk project:

1. `start_agent_run` at session start; then `get_next_task` — only released (`todo`) tasks whose prerequisites are `done` are workable.
2. Read the task's linked spec document.
3. Confirm the gate is **red** before work starts (green-at-start proves nothing).
4. Dispatch to a worker from `workers/` per `routing.md`; require proof.
5. Read the diff; apply the task's lane from `lanes.md` (`auto` / `approve` / `full`).
6. Flip the task `done` atomically, `record_agent_progress`, and append a line to `runs/metrics.jsonl`.
7. When the frontier empties: run the goal's `verification_surface`, `complete_goal`, `complete_agent_run`.

Humans steer from the board: releasing `scope` tasks, resolving `approve`-lane comments, and owning every merge.

## Command

```bash
plandesk factory init [--repo <dir>] [--print] [--force]
plandesk factory sync [--write] [--force] [--repo <dir>]
```

| Flag      | Purpose                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `--repo`  | Target repository (default: cwd)                                                                     |
| `--print` | `init` dry-run: print every artifact without writing                                                 |
| `--write` | `sync` only: apply creates + safe updates, keeping your customized files (default is a dry-run plan) |
| `--force` | `init`: scaffold even in a global config dir · `sync`: also overwrite customized files               |

`factory sync` updates scaffolded policy to the latest shipped version **without clobbering your edits** — it classifies each file as up-to-date / create / safe-update / customized and, with `--write`, applies the safe ones (and refreshes generated adapters). See [Upgrading → Sync the factory policy](/reference/upgrading/#sync-the-factory-policy).
