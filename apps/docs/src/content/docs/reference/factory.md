---
title: Factory workspace
description: The project-local .agents/ factory format — portable, file-based agent policy that Plan Desk scaffolds and any harness can consume.
---

`plandesk factory init` scaffolds a **project-local agent factory workspace**: a small tree of markdown policy files under `.agents/` that defines how delegated agent work runs in this repository — the work cycle, the worker roster, the risk lanes, and the per-change verifiers. Plan Desk is the scheduler (the board); these files are the policy.

The format is deliberately harness-neutral. Claude Code consumes it today through a thin command adapter; any other runtime (Codex, a workflow engine like Mastra, your own orchestrator) can consume the same files, because the format follows conventions that are converging across the ecosystem: path-derived identity, markdown with minimal frontmatter, and permissive consumers.

## Why project-local

Agent config written into global directories (`~/.claude`, `~/.codex`) leaks into every project on the machine — a `CLAUDE.md` include there loads in every session everywhere. The factory workspace therefore always lives **in the repository**, versioned with the code it governs. Both `plandesk factory init` and `plandesk connect` refuse to write into your home directory or a global config directory (`factory init --force` overrides, if you really mean it).

## The scaffold

```
.agents/
├─ index.md                    # progressive disclosure: what lives here
└─ factory/
   ├─ factory.md               # the contract: how a work cycle runs (type: factory)
   ├─ protocol.md              # deterministic dispatch + result contract (type: protocol)
   ├─ workers/                 # one file per worker CLI (type: worker)
   │  ├─ claude.md             #   probe + command template with {prompt_file}
   │  ├─ codex.md
   │  ├─ cursor.md
   │  ├─ grok.md
   │  └─ opencode.md
   ├─ lanes.md                 # risk lanes: which changes need which human gates (type: lanes)
   ├─ verifiers/
   │  └─ tests-pass.md         # example per-change check (type: verifier)
   └─ runs/                    # transient machine state — gitignored
.claude/commands/factory.md    # generated adapter: /factory loads the contract
.codex/commands/factory.md     # generated adapter (when a .codex/ setup is detected)
```

Two zones with different ownership:

- **Authored policy** (`index.md`, `factory.md`, `protocol.md`, `workers/*`, `lanes.md`, `verifiers/*`) — scaffolded **once**, then yours. Re-running `factory init` never overwrites them (`skip` in the summary). Edit them, commit them; they are the repository's operating policy.
- **Generated adapters** (`.claude/commands/factory.md`, `.codex/commands/factory.md`) — one-line includes, refreshed on every run.
- **Transient state** (`factory/runs/`) — machine output such as `metrics.jsonl`; gitignored by the scaffold.

## Format rules

The format is small on purpose; it borrows the conformance posture of the Open Knowledge Format and the Agent Skills spec:

1. **One required frontmatter field.** Every policy file declares a `type` (`factory`, `workers`, `lanes`, `verifier`). Everything else is optional.
2. **Identity is the path.** A file's name is its name — no `id` fields, no registry. `verifiers/tests-pass.md` *is* the verifier `tests-pass`.
3. **Consumers are permissive.** Tools reading `.agents/` MUST tolerate unknown types, unknown frontmatter keys, and links to files that do not exist yet. Old consumers never break on new producers — this is what lets one repo serve Claude Code today and a hosted orchestrator later without changing a file.
4. **Markdown is the interchange layer.** Guidance (contracts, rosters, policy) lives in markdown and ports across harnesses. Anything executable a specific runtime needs is compiled *from* these files, never written back into them.

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

## Installing skills

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

- **Humans** drag the card between columns on the Board view (five columns: Scope, Todo, In progress, Done, Backlog) — the drop issues the status change, live for every connected agent within ~2s.
- **Agents** technically can call `update_task` with `status: "todo"` — the API does not restrict transitions. The enforcement in the current design is at *read* time: `get_next_task` never returns unreleased work, and the factory contract instructs the supervisor to treat release as human-owned.

In other words: the release gate is mechanism-enforced for *pulling* work and convention-enforced for *promoting* it. If your policy needs hard human-only release (e.g. regulated repos), keep `update_task`-driven promotion out of your supervisor's contract — and watch the changelog: token-scoped transition rules are a candidate hardening.

## The cycle

`factory.md` documents the full loop; in short, a supervising agent session works the bound Plan Desk project:

1. `get_next_task` — only released (`todo`) tasks whose prerequisites are `done` are workable.
2. Read the task's linked spec document.
3. Confirm the gate is **red** before work starts (green-at-start proves nothing).
4. Dispatch to a worker from `workers.md`; require proof.
5. Read the diff; apply the task's lane from `lanes.md` (`auto` / `approve` / `full`).
6. Flip the task `done` atomically and append a line to `runs/metrics.jsonl`.

Humans steer from the board: releasing `scope` tasks, resolving `approve`-lane comments, and owning every merge.

## Command

```bash
plandesk factory init [--repo <dir>] [--print] [--force]
```

| Flag      | Purpose                                                        |
| --------- | -------------------------------------------------------------- |
| `--repo`  | Target repository (default: cwd)                               |
| `--print` | Dry-run: print every artifact without writing                  |
| `--force` | Scaffold even in a global config directory (you own the blast) |
