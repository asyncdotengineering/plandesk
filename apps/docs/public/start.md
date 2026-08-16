# Set up Plan Desk for this project

You are a coding agent (Claude Code, Codex, or similar) in a user's project
folder. Set up **Plan Desk** so the user can plan on a graph and have an agent
execute it over MCP. Plan Desk is local-first: a task-node canvas with dependency
edges, specs on nodes, a board, and an MCP server agents drive via `.mcp.json`.
Data lives in a local SQLite file. Docs: https://plandesk.asyncdot.com (or
`plandesk help` once installed).

**Known snags — check these before running anything:**

- **Already on Plan Desk 0.20.x or earlier?** The 1.0 schema change is
  breaking — do not run `plandesk init`/`connect` straight against an old
  board. Run `plandesk legacy-upgrade` first; see
  https://plandesk.asyncdot.com/reference/upgrading.
- **A server might already be running on the default port** — possibly
  serving a _different_ board than the one you expect. Check with
  `curl "$(plandesk url)/api/v1/projects"` before assuming step 2's "server
  is up" means _your_ board is up; pass `--port <n>` to run a second one.
- **An existing local `.plandesk/workspace.db` in this repo?** `plandesk
init`/`serve` silently prefer a repo-local board over the machine-global
  one when they find one already there. If you didn't intend a repo-local
  board, see step 3 below before proceeding.

**Two-phase setup — read all of it before running anything.**

- **Phase A (this session):** install the CLI, start the server, create/select a
  project, bind this repo. Done from the shell — the Plan Desk MCP tools are _not_
  loaded yet this session.
- **Phase B (a new session):** the user starts a fresh session; the MCP tools load
  from `.mcp.json`, and the agent plans and builds from the live graph.

## Rules (do not violate)

- **Stay in this folder.** Operate only within the current working directory. Do
  not touch other repositories or global state beyond installing the CLI.
- **Never invent or hardcode tokens or secrets.** Local loopback `connect`
  writes no token at all. If this repo connects to a hosted org, use only the
  token `connect --to` generates — it is written to `.plandesk/token`, which is
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

# Initialize the machine-global board at ~/.plandesk (idempotent; not committed)
# Opt into a repo-local db with: plandesk init --local-db
plandesk init

# UPGRADING an existing install (Plan Desk 0.20.x or earlier)? The schema + board
# location changed — an old workspace.db won't load directly. Instead of `init`,
# run `plandesk legacy-upgrade` once: it creates the new board AND imports your
# old projects/tasks/docs (old file backed up). See docs → Upgrading. Fresh
# install: ignore this and keep the `plandesk init` above.

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

**Already bound?** If `.plandesk/config.json` exists in this repo, it's already
bound — skip to step 5. No token export needed either way: `.mcp.json`'s
`headersHelper` reads `.plandesk/token` automatically when one exists (hosted
only — see step 4), and local loopback needs no token at all.

**`.plandesk/` exists but there's no `config.json`?** A `.plandesk/workspace.db`
with no sibling `config.json` is a **pre-1.0 legacy per-repo board** (v1's
binding model didn't exist yet), not a v1 binding — do not run `connect` on top
of it, it will not pick up that data. Either move it aside first
(`mv .plandesk/workspace.db .plandesk/workspace.db.pre-1.0`) so `init`/`connect`
start clean, or import it into the current board with
`plandesk legacy-upgrade --from .plandesk/workspace.db` (see
https://plandesk.asyncdot.com/reference/upgrading), then continue below.

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
# .mcp.json (a headersHelper reads .plandesk/token automatically when one
# exists — no export needed), skill symlinks in .claude/skills/plandesk/ and
# .agents/skills/plandesk/, and an idempotent @.plandesk/skill.md include in
# CLAUDE.md / AGENTS.md. Local loopback connect (this command, no --to) writes
# NO .plandesk/token — the server treats a loopback connection as its owner.
plandesk connect --project "<PROJECT NAME>"
```

`connect` is idempotent and commit-safe: everything it writes is safe to
commit. This local/loopback path writes no token file at all, so there is
nothing to gitignore here. Only the **hosted** path (`connect --to <org>`,
see "Optional: connect to a hosted org" below) writes `.plandesk/token` — in
that case `connect` gitignores it for you; confirm `.plandesk/token` appears
in `.gitignore`.

## 5. Scaffold the factory workspace

```bash
# Writes the repo's agent operating policy under .agents/ and wires the Claude
# Code hooks. Authored files are created once and never overwritten; re-running
# only refreshes the generated adapters (idempotent).
plandesk factory init
```

What this writes:

- **Factory policy** (`.agents/factory/`): factory.md (the per-item serial
  contract + agent-run lifecycle), execution.md (IC spine: decompose, drive to
  zero, ship), optional companions (slicing / brief / heartbeat), plus
  protocol.md, routing.md, lanes.md, verifiers/, workers/ (one file per agent
  CLI, probed). `factory init` writes a **managed sentinel block** into
  `CLAUDE.md` / `AGENTS.md`: a crisp "default operating mode" preamble (follow
  the cycle, delegate to a probed worker when one is installed else do it
  yourself, execute without pausing, prove before done) plus **one always-on
  @-include — factory.md**. The IC spine is referenced by path in the preamble
  and read on demand, not inlined into every session. The `/factory` command
  loads factory.md + execution.md.
- **Skills** (`.agents/skills/plandesk-*/` → `.claude/skills/`): plan-writer, scope-work,
  groom-task, foreman, autonomy, timebox.
- **Claude Code hooks**: `.agents/factory/hooks/session-start.sh` + `checkpoint.sh`,
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
      (the helper works whether or not that file exists — local loopback has none)
- [ ] Only if you connected to a **hosted** org: `.plandesk/token` exists and is
      listed in `.gitignore`. Local loopback creates no token file, so skip this
      check in that case.
- [ ] `CLAUDE.md` (and `AGENTS.md` if present) contains the `@.plandesk/skill.md` include
- [ ] the board is **not** committed: default is `~/.plandesk/workspace.db` (one board per machine). Travel/backup is hosted (`plandesk push --to <org>`) or an explicit `plandesk export --project <id> --out <path>` outside the repo. Per-machine state stays ignored: `.plandesk/token` (bearer minted per-clone by `connect`) and `.plandesk/server.json`. Everything else under `.agents/`, `.claude/`, `.mcp.json`, `.plandesk/config.json`, `.plandesk/skill.md` is committed policy.
- [ ] `.agents/factory/factory.md` exists (factory scaffold; unless the user opted out)
- [ ] `.claude/settings.json` wires `SessionStart`/`Stop`/`PreCompact` to `.agents/factory/hooks/*` (hooks registered — unless the user opted out of the factory)

## 7. Hand off to a planning session

Setup is done. Tell the user, verbatim:

> Plan Desk is connected to this repo. **Start a new agent session here** so the Plan
> Desk MCP tools load (you'll see 46 tools). No export needed — local loopback
> needs no token, and a hosted connection's token is read from
> `.plandesk/token` automatically. In that session, run
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

## Optional: connect to a hosted org

**Local is the default.** Everything above is zero-auth, offline, and agent-runnable
unattended. Hosting is opt-in — only do this when the user wants this repo bound to a
hosted organization (asyncdot or their self-hosted instance).

**Agents never log in.** Hosted auth has an irreducible human step. A fresh agent cannot
authenticate to a hosted org from nothing. You **ask the human** to generate and paste
the owner key; you only run `connect --to` after that.

1. **Ask the human** to open the Plan Desk dashboard (signed in via GitHub), click
   **Generate CLI token**, and copy the org-wide owner key (shown once).
2. **Ask the human** to run (or paste into your terminal for them):

```bash
plandesk login
# prompts: Plan Desk token:  ← human pastes the owner key
# stores { server, token, orgId } in ~/.plandesk/config.json
```

For a non-default server: `plandesk login --server https://your-host.example`.

3. **You (the agent)** then provision a scoped agent key for this repo:

```bash
plandesk connect --to <org> --project "<PROJECT NAME>"
```

This mints a **project-scoped agent key** and writes it to `.plandesk/token`
(gitignored). MCP reads it via `${PLANDESK_MCP_TOKEN:-$(cat .plandesk/token)}`.
The agent never sees or stores the owner key — only the scoped key.

Then continue from step 5 (factory init) and step 6 (verify) as usual. Do not invent
flags (`--org` does not exist); use exactly `login` and `connect --to`.

## What to commit

For a repo connected to Plan Desk, commit:

- `.plandesk/config.json` — the project/workspace binding (step 4).
- `.mcp.json` — the MCP server entry (step 4). Its `headersHelper` reads a
  token file that may not exist — nothing secret lives in the entry itself.
- `.claude/` — skills (`.claude/skills/plandesk/`), the `/plandesk` command
  (`.claude/commands/plandesk.md`), and `.claude/settings.json` (the board-as-memory
  hooks `factory init` wires up in step 5).
- `.agents/` — the agent policy and skills (`.agents/factory/`,
  `.agents/skills/`) written by `plandesk factory init` (step 5).
- `.factory`, if this repo has one — treat it like the rest of the committed
  agent policy.
- `CLAUDE.md` / `AGENTS.md` — the sentinel block `connect` inserts (step 4).

Gitignore (already handled for you where noted):

- `.plandesk/token` — **hosted only**; a scoped agent key. Local loopback (the
  default path in step 4) writes none, so there's nothing to ignore in that
  case. `connect --to` adds this line for you.
- `.plandesk/server.json` — per-machine server info; `plandesk init` adds this
  line for you.
- `.plandesk/workspace.db` (and any `.pre-*` backup copies) — only exists if
  you opted into a repo-local board with `plandesk init --local-db`; the
  default global board at `~/.plandesk/workspace.db` never lives in the repo
  at all. Add it to `.gitignore` yourself if you use `--local-db` — it is
  **not** auto-ignored.
- `.agents/factory/runs/` — transient factory dispatch state (briefs, logs,
  results); `plandesk factory init` writes a nested `.gitignore` there for you.

---

**Done when:** the verify checklist in step 6 passes and you've given the user the
hand-off instructions in step 7. Do not claim success until `plandesk doctor --repo .`
is clean and `.plandesk/config.json` has a real `projectId`.
