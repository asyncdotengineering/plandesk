---
title: Your first project
description: Plan a project on the canvas, attach specs, and track status on the board.
---

This walkthrough assumes Plan Desk is installed and running. If not, follow the [Quickstart](/getting-started/quickstart/) first.

## 1. Start the server and create a project

```bash
plandesk serve
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). On the home page, click **Create a project**, enter a name (e.g. `Checkout Revamp`), and open it.

## 2. Map work on the flow canvas

Go to **Flow** (`/projects/:id/flow`). The canvas is a directed graph:

- **Nodes** are tasks — each card is a unit of work with a label and status badge.
- **Edges** are labeled dependencies between tasks — they show what blocks or feeds what.

Add a few task cards (double-click the canvas or use the add control). Drag cards to arrange them. Draw dependency edges between related tasks and pick a label from the vocabulary: `blocks`, `depends_on`, `unblocks`, `feeds`, `clarifies`, `enables`, `supports`.

Set initial statuses as you go: `scope` for work still being sized, `todo` for defined work ready to pick up.

## 3. Attach a spec to a task

Every non-trivial task should have a linked document. Create one from the canvas:

1. Select a task node and open its linked doc (e.g. **Open doc →** on the node).
2. Or create a document from the project sidebar and link it to the task.

Write a short spec: problem statement, acceptance criteria, references. The doc opens at `/projects/:id/documents/:docId` and stays linked to its task — agents and teammates reach it in one click from the canvas.

## 4. Track status on the board

Open **Board** (`/projects/:id/board`). Columns follow task status: `scope`, `todo`, `in_progress`, `done`, `backlog`.

Drag a card from **todo** to **in_progress**, then to **done**. Switch back to **Flow** — the node's status badge updates immediately. The board and canvas share the same task rows; there is no separate board state.

## 5. Export and import for portability

Projects round-trip losslessly as JSON:

```bash
plandesk export --project <project-id> --out my-plan.json
plandesk import --in my-plan.json
```

Try the ready-made example:

```bash
plandesk import --in examples/checkout-revamp.json
```

Import prints the new project UUID — open it in the UI to explore a full canvas with edges, linked docs, and agent-run history.

## What's next

When the plan is ready for execution, connect an agent and work from the live graph: [Plan & execute a project](/guides/plan-and-execute/).
