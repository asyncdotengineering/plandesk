# Set up Plan Desk for this project

You are a coding agent (Claude Code, Codex, or similar) running inside a user's
project folder. Your job: set up **Plan Desk** for _this_ project so the user can
plan work on a graph and have an agent execute it over MCP — then hand off to a
fresh session where the Plan Desk tools are live.

Plan Desk is a local-first planning workspace: a flow canvas of task nodes with
labeled dependency edges, specs attached to nodes, a board, and an MCP server (29
tools) agents use to read and update the plan. Data lives in a local SQLite file.
Docs: https://plandesk.asyncdot.com — or, once the CLI is installed (step 2), run
`plandesk help` for a crash course and the exact docs to read.

**This is a two-phase setup. Read all of it before running anything.**

- **Phase A (this session):** install the CLI, start the local server, create or
  select a project, and bind this repo. You do this with the shell — the Plan Desk
  MCP tools are _not_ loaded in this session yet.
- **Phase B (a new session):** once bound, the user starts a fresh agent session;
  the Plan Desk MCP tools load from the repo's `.mcp.json`, and the agent plans and
  builds from the live graph.

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
repo so your naming fits:

1. Fetch the agent conventions: https://plandesk.asyncdot.com/connecting-agents/skill/
2. Skim the end-to-end workflow: https://plandesk.asyncdot.com/guides/idea-to-development/
3. Inspect the current folder — language, package manager, and the project's
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

# Initialize the local workspace DB (idempotent; ~/.plandesk/workspace.db)
plandesk init

# Is a server already running on this project's port?
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "Plan Desk server is up" \
  || echo "No server yet — start one (next step)"
```

If no server is running, the user must run a **long-lived** server. Ask them to run
this in a **separate terminal** (recommended), then continue once it's up:

```bash
plandesk serve        # serves UI + API + MCP — run 'plandesk url' after start for the address
```

(If the user prefers, you may start it backgrounded — `plandesk serve >/tmp/plandesk.log 2>&1 &` —
but warn them it stops when this session's shell exits; a dedicated terminal is better.)

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

## 5. Verify the setup

```bash
plandesk doctor --repo .
```

Confirm all of:

- [ ] `plandesk --version` prints a version (CLI installed)
- [ ] `curl "$(plandesk url)/api/v1/projects"` returns JSON (server reachable)
- [ ] `.plandesk/config.json` exists and has a `projectId`
- [ ] `.mcp.json` has a `plandesk` server entry with a `headersHelper` reading `.plandesk/token`
- [ ] `CLAUDE.md` (and `AGENTS.md` if present) contains the `@.plandesk/skill.md` include
- [ ] `.plandesk/token` is gitignored and **not** staged for commit

## 6. Hand off to a planning session

Setup is done. Tell the user, verbatim:

> Plan Desk is connected to this repo. **Start a new agent session here** so the Plan
> Desk MCP tools load (you'll see 29 tools). The token is read from
> `.plandesk/token` automatically — no export needed.
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

**Done when:** the verify checklist in step 5 passes and you've given the user the
hand-off instructions in step 6. Do not claim success until `plandesk doctor --repo .`
is clean and `.plandesk/config.json` has a real `projectId`.
