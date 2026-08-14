---
title: Introduction
description: What Plan Desk is and who it's for.
---

**Plan Desk** is a local-first, self-hostable planning workspace — canvas + docs-on-nodes + tasks + board + MCP for product teams and agent workflows.

Plan Desk is a graph-native planning app you run on your machine: map dependencies on a flow canvas, attach specs to nodes, track status on a board, and let Claude Code or Codex read and update the plan over MCP. Documents and notes edit on a Notion-style canvas with autosave — no Save button. Data stays in a local SQLite workspace; export/import keeps projects portable.

## Set up with your coding agent

Don't want to read docs? Point your agent at the setup runbook and let it wire Plan Desk into the current repo for you. Paste this into Claude Code (or Codex) **from your project folder**:

```text
Run this in bash: curl -fsSL https://plandesk.asyncdot.com/start.md | cat
Then follow the instructions to set up Plan Desk for this project.
```

The agent installs the CLI, starts the local server, creates or binds a project, and verifies — scoped to your folder, no secrets committed. Then start a fresh session and it plans and builds from the live graph. Walkthrough: [From idea to development with Claude Code](/guides/idea-to-development/).

## What you get

- **Canvas** — directed labeled edges between task nodes, auto-layout packs disconnected nodes into a grid
- **Docs on nodes** — attach specs to tasks; open a node to reach its primary doc in one click; a folder-based browser organizes them
- **Notion-style editor** — documents, notes, and task descriptions edit on a full-height canvas with a `/` slash menu, `[[` document links, and autosave (~1s debounce, no Save button)
- **Image annotation** — mark up images WhatsApp-style (arrow, box, text, blur-redact) in the editor and in comments; blur redaction is permanent and safe to use on secrets
- **Board** — kanban view sharing the same task status as the canvas (single source of truth); every destructive action asks first
- **Notes** — free-form, project-scoped working notes in a rich-text editor, separate from formal docs
- **Rich comments** — full-editor comments with formatting, images, and annotation, on documents, tasks, notes, and artifacts
- **Files** — upload an image via MCP (`attach_file`) and embed it with a short URL instead of inlining base64
- **Agent share links** — mint a public, expiring Markdown link for one task or document (`create_share_link`) to hand a sub-agent or worker full context via a URL, no MCP access required
- **Artifacts** — stored agent deliverables (Markdown/HTML reports, RFCs) a human annotates via the CLI previewer and the agent revises — the same `artifact_id` closes the produce → annotate → revise loop
- **MCP** — 64 tools for agents to scaffold plans, pick the next task, read/write tasks, docs, notes, files, artifacts, share links, comments, and agent runs
- **Portable data** — lossless `plandesk-export-v2` JSON export/import (v1 files still import)

## Next steps

- [Quickstart](/getting-started/quickstart/) — install from npm, init, serve, open the UI
- [Your first project](/getting-started/first-project/) — plan on the canvas, attach specs, use the board
- [Plan & execute a project](/guides/plan-and-execute/) — connect an agent and work from the live plan
- [Self-host with Docker](/self-hosting/docker/) — run on `0.0.0.0` with auth
- [Connect an agent](/connecting-agents/mcp-setup/) — wire Claude Code or Codex via MCP
