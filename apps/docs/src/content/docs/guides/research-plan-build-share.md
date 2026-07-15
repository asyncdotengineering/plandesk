---
title: Research → plan → build → share
description: Research an idea, build from a structured plan, and collaborate through a moderated hosted portal.
---

Use Plan Desk as the working graph for a project: research the idea, capture goals and dependencies, build locally with your agent, then promote the project when an outside team needs a view.

## 1. Research and plan

Ask your coding agent to inspect the codebase and turn the result into a project with goals, tasks, dependency edges, and linked specifications. Review the graph on the Flow canvas and steer it with comments.

## 2. Build from the plan

Tasks move through `scope`, `todo`, `in_progress`, and `done`. The agent reads the same local graph through MCP, so the plan remains the source of truth while implementation and review happen in the repository.

## 3. Share deliberately

Promote the project to the target hosted organization, then create a share:

```bash
plandesk push --to <org-id>
plandesk share create --audience "Acme" --public --allow-submit
```

The portal serves a read-only view computed from the hosted project and polls for changes. Participants can submit issues into a moderated inbox; they cannot edit the plan.

## 4. Pull and triage

```bash
plandesk pull
```

Review each submission and use `triage_submission` to reject it, accept it as a task, or link it to existing work. The accepted task returns to the normal agent loop.
