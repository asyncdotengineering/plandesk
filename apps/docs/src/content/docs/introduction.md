---
title: Introduction
description: What Plan Desk is and who it's for.
---

**Plan Desk** is a local-first, self-hostable planning workspace — canvas + docs-on-nodes + tasks + board + MCP for product teams and agent workflows.

Plan Desk is a graph-native planning app you run on your machine: map dependencies on a flow canvas, attach specs to nodes, track status on a board, and let Claude Code or Codex read and update the plan over MCP. Data stays in a local SQLite workspace; export/import keeps projects portable.

## Set up with your coding agent

Don't want to read docs? Point your agent at the setup runbook and let it wire Plan Desk into the current repo for you. Paste this into Claude Code (or Codex) **from your project folder**:

```text
Read https://plandesk.asyncdot.com/start.md then set up Plan Desk for this project.
```

The agent installs the CLI, starts the local server, creates or binds a project, and verifies — scoped to your folder, no secrets committed. Then start a fresh session and it plans and builds from the live graph. Walkthrough: [From idea to development with Claude Code](/guides/idea-to-development/).

## What you get

- **Canvas** — directed labeled edges between task nodes
- **Docs on nodes** — attach specs to tasks; open a node to reach its primary doc in one click
- **Board** — kanban view sharing the same task status as the canvas (single source of truth)
- **MCP** — 18 tools for agents to scaffold plans, pick the next task, read/write tasks, docs, comments, and agent runs
- **Portable data** — lossless `plandesk-export-v1` JSON export/import

## Next steps

- [Quickstart](/getting-started/quickstart/) — install from npm, init, serve, open the UI
- [Your first project](/getting-started/first-project/) — plan on the canvas, attach specs, use the board
- [Plan & execute a project](/guides/plan-and-execute/) — connect an agent and work from the live plan
- [Self-host with Docker](/self-hosting/docker/) — run on `0.0.0.0` with auth
- [Connect an agent](/connecting-agents/mcp-setup/) — wire Claude Code or Codex via MCP
