---
type: workflow
version: 1
---

# Orchestrator workflow (shipped default — edit me)

The session program for an agent asked to work this repository: what happens
from "work on this repo" to the final report. [factory.md](factory.md) governs
each work item; this file governs the session. It is a shipped default —
rewrite it to fit how this repository actually works.

## 1. Orient

- Read [../index.md](../index.md), this file, and [factory.md](factory.md).
- Reconcile the board against reality (recent commits, working tree): fix any
  status that drifted before starting new work.
- Pull open comments (`list_comments`); address or acknowledge them first.

## 2. Intake (only when asked to plan)

- New idea or RFC → `scaffold_project_from_plan`: a task per unit of work
  (`todo`/`scope`), dependency edges, a `Design:` doc on the first task.
- Assign each task a lane from [lanes.md](lanes.md) at creation.
- Then stop — humans release `scope` → `todo` on the board.

## 3. Execute (the default mode)

- `start_agent_run`, then loop the [factory.md](factory.md) cycle over
  `get_next_task` until nothing is actionable or a gate blocks.
- One task at a time; serial within a project.
- `record_agent_progress` every cycle. Blockers become tasks or comments —
  never a silent stop.

## 4. Finish

- `complete_agent_run`. Report at diff level: what shipped, what is gated on
  a human, what failed and why. Leave the board true.

## Customizing

This file is yours — `factory init` never overwrites it. Common edits: a
different intake ritual, extra finishing passes (lint, review commands), a
repo-specific definition of done, cadence notes for scheduled runs.
