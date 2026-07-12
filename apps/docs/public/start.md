# Set up Plan Desk for this project

You are a coding agent (Claude Code, Codex, or similar) in a user's project
folder. Set up **Plan Desk** so the user can plan on a graph and have an agent
execute it over MCP. Plan Desk is local-first: a task-node canvas with dependency
edges, specs on nodes, a board, and an MCP server agents drive via `.mcp.json`.
Data lives in a local SQLite file. Docs: https://plandesk.asyncdot.com (or
`plandesk help` once installed).

**Two-phase setup — read all of it before running anything.**

- **Phase A (this session):** install the CLI, start the server, create/select a
  project, bind this repo. Done from the shell — the Plan Desk MCP tools are _not_
  loaded yet this session.
- **Phase B (a new session):** the user starts a fresh session; the MCP tools load
  from `.mcp.json`, and the agent plans and builds from the live graph.

## Rules (do not violate)

- **Stay in this folder.** Operate only within the current working directory. Do
  not touch other repositories or global state beyond installing the CLI.
- **Never invent or hardcode tokens or secrets.** Use only the token that
  `plandesk connect` generates. It is written to `.plandesk/token`, which is
  gitignored — never commit it, never paste it into a committed file, never echo it
  into the repo.
- **Don't guess IDs.** Resolve the project from `.plandesk/config.json` once bound.
- **Local-first.** The server runs on the user's machine. Do not deploy anything.
- **Ask when a choice is real.** Project name, or reuse-vs-create — ask the user;
  don't pick silently.
- Requires **Node ≥ 20**.

## 1. Gather context

Before acting, read the conventions you'll be expected to follow and inspect the
repo so your naming fits. Run these in bash:

```bash
# Agent conventions (how to use Plan Desk tools in an agent session)
curl -fsSL https://plandesk.asyncdot.com/connecting-agents/skill.md | cat

# End-to-end workflow guide
curl -fsSL https://plandesk.asyncdot.com/guides/idea-to-development.md | cat
```

Then inspect the current folder — language, package manager, and the project's
purpose (e.g. read `README.md`, `package.json`) — so you can suggest a sensible
project name and, later, a useful plan.

## 2. Install / upgrade the CLI and start the server

**Run this even if the CLI is already installed** — the version on disk may be outdated
and missing commands this guide requires (e.g. `plandesk url`).

```bash
# Upgrade or install — always run this, do not skip (Node >= 20)
npm i -g @plandesk/cli@latest

# Orient yourself (and the user) — a crash course + the docs to read, from the CLI:
plandesk help

# Learn how to work in a Plan Desk repo — the board, the execution loop,
# delegation, and the MCP tools. Read this once; it teaches the agent the model.
plandesk onboard

# Initialize the local workspace DB (idempotent; repo-local .plandesk/workspace.db)
plandesk init

# Is a server already running on this project's port?
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "Plan Desk server is up" \
  || echo "No server yet — start one (next step)"
```

If no server is running, start it backgrounded so setup can continue without user
intervention:

```bash
plandesk serve >/tmp/plandesk.log 2>&1 &
sleep 2
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "server up" \
  || (echo "server not ready yet, waiting..."; sleep 3; curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 && echo "server up" || echo "FAILED — check /tmp/plandesk.log")
```

Tell the user it's running in the background and that `plandesk serve` in a dedicated
terminal is better for persistent use (it won't stop when this session exits).

## 3. Create or select the project

If `.plandesk/config.json` already exists in this repo, it's already bound — skip to
step 5 and just refresh the token export.

Otherwise, ask the user: **reuse an existing Plan Desk project, or create a new one?**
Default new-project name = this folder's name.

To create a new project (REST is open on the local single-user server):

```bash
curl -fsS -X POST "$(plandesk url)/api/v1/projects" \
  -H 'content-type: application/json' \
  -d '{"name":"<PROJECT NAME>","description":"<one line>"}'
```

Or have the user create one in the UI at the address printed by `plandesk url`.

## 4. Bind this repo to the project

```bash
# Writes .plandesk/config.json (binding), .plandesk/skill.md (agent conventions),
# .plandesk/token (gitignored), .mcp.json (a headersHelper reads the token file
# automatically — no export needed), skill symlinks in .claude/skills/plandesk/
# and .agents/skills/plandesk/, and an idempotent @.plandesk/skill.md include
# in CLAUDE.md / AGENTS.md.
plandesk connect --project "<PROJECT NAME>"
```

`connect` is idempotent and commit-safe: everything it writes is safe to commit
**except** `.plandesk/token`, which it gitignores for you. Confirm `.plandesk/token`
appears in `.gitignore`.

## 5. Scaffold the factory workspace

```bash
# Writes the repo's agent operating policy under .agents/ and wires the Claude
# Code hooks. Authored files are created once and never overwritten; re-running
# only refreshes the generated adapters (idempotent).
plandesk factory init
```

What this writes:

- **Factory policy** (`.agents/factory/`): workflow.md (the session program),
  factory.md (the per-task contract), and autonomous-stand.md (the execution
  posture: decompose a goal, drive the task list to zero, ship without pausing),
  plus protocol.md, lanes.md, verifiers/, workers/ (one file per agent CLI,
  probed). `factory init` writes a **managed sentinel block** into `CLAUDE.md` /
  `AGENTS.md`: a crisp "default operating mode" preamble (follow the cycle,
  delegate to a probed worker when one is installed else do it yourself,
  autonomous-stand, prove before done) plus **one always-on @-include —
  factory.md**, the per-item contract. The session program and execution posture
  are referenced by path in the preamble and read on demand, not inlined into
  every session. The full set is also exposed together as a `/factory` command.
- **Curator skills** (`.agents/curator/` → `.claude/skills/`): triage, intake,
  autonomy, provenance, automation.
- **Claude Code hooks**: `.agents/curator/hooks/session-start.sh` + `checkpoint.sh`,
  wired into `.claude/settings.json` on `SessionStart` (startup|resume|compact),
  `Stop`, `PreCompact`. **This is how Claude Code discovers the hooks** — the
  session-start hook re-anchors the agent to the board; the checkpoint hook
  records progress before stop/compact. Both no-op safely until `connect` binds.

The policy travels with `git clone`, works with whichever agent CLIs each machine
has (workers are probed, never assumed), and keeps every gate on the board. Skip
only if the user wants planning with no agent execution. Both `connect` and
`factory init` refuse to run in global config dirs (`~/.claude`, `~/.codex`, …) —
agent config belongs to the project, not the machine.

## 6. Verify the setup

```bash
plandesk doctor --repo .
```

Confirm all of:

- [ ] `plandesk --version` prints a version (CLI installed)
- [ ] `curl "$(plandesk url)/api/v1/projects"` returns JSON (server reachable)
- [ ] `.plandesk/config.json` exists and has a `projectId`
- [ ] `.mcp.json` has a `plandesk` server entry with a `headersHelper` reading `.plandesk/token`
- [ ] `CLAUDE.md` (and `AGENTS.md` if present) contains the `@.plandesk/skill.md` include
- [ ] the board travels with the repo: `.plandesk/workspace.db` is **tracked** (committed), so the plan/graph is shared across clones. Per-machine state stays ignored: `.plandesk/token` (bearer minted per-clone by `connect`) and `.plandesk/server.json` (this machine's server URL/port) must remain gitignored and unstaged. Everything else under `.agents/`, `.claude/`, `.mcp.json`, `.plandesk/config.json`, `.plandesk/skill.md` is committed policy.
- [ ] `.agents/factory/factory.md` exists (factory scaffold; unless the user opted out)
- [ ] `.claude/settings.json` wires `SessionStart`/`Stop`/`PreCompact` to `.agents/curator/hooks/*` (hooks registered — unless the user opted out of the factory)

## 7. Hand off to a planning session

Setup is done. Tell the user, verbatim:

> Plan Desk is connected to this repo. **Start a new agent session here** so the Plan
> Desk MCP tools load (you'll see 46 tools). The token is read from
> `.plandesk/token` automatically — no export needed. In that session, run
> `plandesk onboard` first to learn how to work in a Plan Desk repo, then plan.
> Anytime, run `plandesk help` for a refresher and the docs worth reading.

Then, in that fresh session, the agent turns the repo's goals into a plan and
executes it. A good first prompt for the user to run there:

> Use Plan Desk MCP. Read this repo's README and scaffold a project plan with
> `scaffold_project_from_plan`: a task per unit of work (`todo`/`scope`), dependency
> edges between them, and a `Design:` spec doc linked to the first task. Then loop
> `get_next_task` → read the linked doc → implement → `update_task` to `in_progress`
> then `done` → `record_agent_progress`. Pull my feedback with `list_comments` and
> `resolve_comment` when addressed. Don't delete tasks.

See https://plandesk.asyncdot.com/guides/idea-to-development/ for the full loop.

---

**Done when:** the verify checklist in step 6 passes and you've given the user the
hand-off instructions in step 7. Do not claim success until `plandesk doctor --repo .`
is clean and `.plandesk/config.json` has a real `projectId`.
