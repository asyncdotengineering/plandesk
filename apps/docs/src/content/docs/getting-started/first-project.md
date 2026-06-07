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

**Add tasks** with the **+ Add task** panel on the canvas: type a name and click **+ Add task** (the button stays disabled until you enter a name). The new card appears on the canvas. Drag cards to arrange them.

**Edit a task** right on its node: click the label to rename it, and use the status dropdown to change its status. Select a node to open its **detail panel**, where you can edit the description, assignee, and due date.

**Draw dependencies** by dragging from one node's handle to another — this creates a labeled dependency edge. Edge labels come from the vocabulary `blocks`, `depends_on`, `unblocks`, `feeds`, `clarifies`, `enables`, `supports`.

Set initial statuses as you go: `scope` for work still being sized, `todo` for defined work ready to pick up.

To remove things, use the delete control on a node (tasks) or select an edge to delete it — deletes ask for confirmation.

## 3. Attach a spec to a task

Every non-trivial task should have a linked document.

1. From the project **Overview**, use **New document** to create one.
2. From the canvas, a task that has a linked doc shows an **Open doc →** link on its node — one click to its editor.

Write a short spec: problem statement, acceptance criteria, references. The doc opens at `/projects/:id/documents/:docId`; you can edit or **delete** it there. Linked docs stay reachable in one click from the canvas — for teammates and agents alike.

## Rename and clean up

From the project **Overview** you can **rename** the project or **delete** it (which removes its tasks, edges, and documents). Deletes confirm first.

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
