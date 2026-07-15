---
title: REST + MCP API
description: REST endpoints and MCP tools exposed by Plan Desk v1.
---

## REST API (v1)

**Base:** `http://127.0.0.1:3847/api/v1`

**Auth:** Bearer `plandesk_mcp_*` or session cookie for UI (v1 single-user: optional password via env)

| Method | Path                          | Purpose                                               |
| ------ | ----------------------------- | ----------------------------------------------------- |
| GET    | `/health`                     | Health check `{ ok: true }`                           |
| GET    | `/projects`                   | List projects                                         |
| POST   | `/projects`                   | Create project `{ name, description? }`               |
| GET    | `/projects/:id`               | Project detail + summary counts                       |
| GET    | `/projects/:id/canvas`        | `{ nodes, edges, layout }`                            |
| PUT    | `/projects/:id/canvas`        | Upsert nodes, edges, layout                           |
| PATCH  | `/projects/:id`               | Rename / update `{ name?, description? }`             |
| DELETE | `/projects/:id`               | Delete project (cascades children)                    |
| GET    | `/projects/:id/documents`     | Document tree                                         |
| POST   | `/projects/:id/documents`     | Create doc `{ title, body, linkedNodeId? }`           |
| GET    | `/documents/:id`              | Document body                                         |
| PATCH  | `/documents/:id`              | Update title/body/status                              |
| DELETE | `/documents/:id`              | Delete document                                       |
| GET    | `/projects/:id/tasks`         | Task list (filter query params)                       |
| POST   | `/projects/:id/tasks`         | Create task `{ label, status?, goal_id?, … }`         |
| PATCH  | `/tasks/:id`                  | Update status, label, description, position           |
| DELETE | `/tasks/:id`                  | Delete task (cascades edges, unlinks docs)            |
| DELETE | `/projects/:id/edges/:edgeId` | Delete a dependency edge                              |
| POST   | `/projects/:id/goals`         | Create goal `{ objective, verification_surface?, … }` |
| GET    | `/projects/:id/goals`         | List goals for a project                              |
| GET    | `/goals/:id`                  | Goal detail incl. `cycle_tasks`                       |
| PATCH  | `/goals/:id`                  | Edit goal contract fields                             |
| POST   | `/goals/:id/pause`            | Pause an active goal                                  |
| POST   | `/goals/:id/resume`           | Resume a paused goal                                  |
| POST   | `/goals/:id/complete`         | Complete goal `{ evidence? }`                         |
| POST   | `/documents/:id/comments`     | Add comment `{ body, passage? }`                      |
| GET    | `/documents/:id/comments`     | Comments for a document                               |
| POST   | `/tasks/:id/comments`         | Add comment on a task                                 |
| GET    | `/tasks/:id/comments`         | Comments for a task                                   |
| POST   | `/notes/:id/comments`         | Add comment on a note                                 |
| GET    | `/notes/:id/comments`         | Comments for a note                                   |
| POST   | `/submissions/:id/comments`   | Add comment on a submission                           |
| GET    | `/submissions/:id/comments`   | Comments for a submission                             |
| GET    | `/projects/:id/comments`      | Comments across a project                             |
| POST   | `/projects/:id/artifact-comments` | Annotate a file `{ artifact_id, body, passage?, anchor? }`        |
| GET    | `/projects/:id/artifact-comments` | Annotations for a file `?artifact_id=…&include_resolved=`         |
| PATCH  | `/comments/:id`               | Edit / resolve `{ body?, resolved? }`                 |
| DELETE | `/comments/:id`               | Delete a comment (UI only)                            |
| POST   | `/projects/:id/files`         | Upload a file `{ filename, mime, content_base64 }` (≤10MB) → `{ id, url, … }` |
| GET    | `/files/:id`                  | Fetch a file; `image/*` renders inline, everything else downloads |
| GET    | `/projects/:id/artifacts`     | List artifact summaries `{ id, title, kind, updated_at }`         |
| POST   | `/projects/:id/artifacts`     | Create artifact `{ title, kind?, content? }`          |
| GET    | `/artifacts/:id`              | Get artifact incl. full `content`                     |
| PATCH  | `/artifacts/:id`               | Update `{ title?, kind?, content? }`                  |
| GET    | `/share/:token.md`            | Agent-ready Markdown for a shared task/document (404 unknown, 410 expired/revoked) |
| GET    | `/events`                     | SSE stream                                            |
| POST   | `/agent-runs`                 | Start run `{ projectId, label? }`                     |
| PATCH  | `/agent-runs/:id`             | Append progress / complete                            |

### Goals

A **Goal** is a durable, graph-native goal-altitude node. Every task belongs to a Goal (`tasks.goal_id`, NOT NULL). A project gets a default **General** goal; task-creation surfaces attach to it unless a `goal_id` is given. Goals decompose into cycle-sized tasks; `get_next_task` walks the active Goal's frontier.

Goal fields: `objective`, `verification_surface` (JSON string — one of `{"kind":"gate_command","command":"..."}`, `{"kind":"acceptance_checklist","items":[{"criterion":"..."}]}`, `{"kind":"human_sign_off"}`), `constraints`, `boundaries`, `iteration_policy`, `stop_condition`, `budget`, `status` (`active` | `paused` | `complete` | `blocked`), `last_verification` (`{ at, green, kind, detail? }` or null).

Evidence-based completion: a Goal completes only when all its cycle-tasks are `done` **and** its `verification_surface` is observed green. The runner submits evidence to `POST /goals/:id/complete`; the API never runs the gate itself. Red evidence blocks the Goal and files a `scope` remediation task.

### Comments

Comments are polymorphic: a single `comments` table keyed by `target_type` (`document` | `task` | `note` | `submission` | `artifact`) + `target_id`, plus `project_id`, `passage`, `anchor`, `body`, `resolved`. `passage` anchors a comment to a text selection; `anchor` holds a W3C Web Annotation selector (JSON) for artifact annotations that re-render. An `artifact` target is a file previewed via `plandesk <file>` — it is project-scoped (the file identity is the `target_id`), so its endpoints live under `/projects/:id/artifact-comments`. Comment bodies are HTML — the composer is a full editor (formatting, inline images, the same annotation overlay as the document editor).

### Files

`POST /projects/:id/files` uploads bytes (base64, ≤10MB) through a pluggable `StorageAdapter` — the default adapter stores content-addressed BLOBs in the workspace DB, so a self-hosted install needs no object storage. `GET /files/:id` serves the file back: `image/*` renders inline (`Content-Type` set, safe to embed), everything else forces a download (`Content-Disposition: attachment`) so an uploaded file can never execute as active content in the browser. Embed the returned `url` as `![alt](url)` in a document, task, or comment body instead of inlining base64 — keeps bodies lean.

### Artifacts

An **artifact** is a stored agent deliverable — a Markdown report, an RFC, an HTML diagram — distinct from the `artifact`-typed comment target above (which annotates *any* file the agent wrote, artifact or not). Artifacts are first-class rows (`title`, `kind`: `markdown` | `html`, `content`) so a human can annotate one with `plandesk <file>` and the agent can revise it in place with the same `artifact_id`: `list_artifact_comments` → address feedback → `update_artifact`.

### Share links

`GET /share/:token.md` returns a single task or document as agent-ready Markdown — linked documents inlined, an instruction at the top to fetch every embedded image, relative URLs absolutized. The link is minted via the MCP `create_share_link` tool (there is no REST creation route), reuses the same `shares` table and `ClientView` projection as the [client-collaboration portal](/reference/collaboration/) — scoped by policy to exactly one resource — and defaults to a 24h TTL (`never` disables expiry). Use it to give a delegated worker full context via a URL without granting it MCP access.

## MCP server

**Endpoint:** `http://127.0.0.1:3847/mcp/` (Streamable HTTP transport)

**Auth header:** `Authorization: Bearer plandesk_mcp_...`

### Tools (v1)

| Tool                         | Purpose                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`              | List accessible projects                                                                                                   |
| `get_project`                | Tasks, docs summary, canvas snapshot                                                                                       |
| `create_project`             | Create a new project                                                                                                       |
| `scaffold_project_from_plan` | Create a project + tasks + edges + docs in one call                                                                        |
| `create_goal`                | Create a goal-altitude node with optional verification surface                                                             |
| `get_goal`                   | Goal detail incl. `cycle_tasks`                                                                                            |
| `list_goals`                 | List goals for a project                                                                                                   |
| `pause_goal`                 | Pause an active goal                                                                                                       |
| `resume_goal`                | Resume a paused goal                                                                                                       |
| `complete_goal`              | Complete a goal with optional verification evidence                                                                        |
| `get_next_task`              | Next actionable `todo` on the active goal frontier (optional `goal_id`; reasons `no_active_goal`, `multiple_active_goals`) |
| `create_task`                | Add canvas node + task row (optional `goal_id`, `tags`)                                                                    |
| `update_task`                | Status, label, description, position, `tags` (replaces set)                                                                |
| `get_task`                   | Fetch a single task by id                                                                                                  |
| `list_tasks`                 | Project tasks, filterable by status and tags (OR)                                                                          |
| `create_document`            | Markdown body; optional link to task                                                                                       |
| `update_document`            | Patch title/body/status line, folder, and `linked_task_id` (null to unlink)                                                |
| `get_document`               | Fetch a document by id                                                                                                     |
| `list_documents`             | Project documents as a tree; filter by `folder_id`                                                                         |
| `create_folder`              | Create a document folder (optionally nested)                                                                               |
| `update_folder`              | Rename / re-parent a folder (cycles rejected)                                                                              |
| `create_note`                | Create a free-form project note (Markdown body)                                                                            |
| `update_note`                | Patch a note's title or body                                                                                               |
| `get_note`                   | Fetch a note by id                                                                                                         |
| `list_notes`                 | Project working notes                                                                                                      |
| `list_tags`                  | Project tags (id, name, color)                                                                                             |
| `create_edge`                | Labeled dependency between tasks                                                                                           |
| `attach_file`                | Upload a file (image today), get back `{ file_id, url }` to embed as `![alt](url)`                                        |
| `create_artifact`            | Store an agent deliverable (report, RFC, HTML diagram); returned `artifact_id` doubles as the comment target              |
| `get_artifact`               | Fetch a stored artifact by id, including full `content`                                                                    |
| `update_artifact`            | Revise a stored artifact's title, content, or kind                                                                          |
| `list_artifacts`             | List artifact summaries for a project (id, title, kind, updated_at)                                                         |
| `create_share_link`          | Mint a public, expiring Markdown link for one task or document `{ url, markdown_url, expires_at }`                         |
| `list_comments`              | Project comments; filter by `target_type`, `target_id`, `include_resolved`                                                 |
| `add_comment`                | Leave a comment `{ target_type, target_id, body, passage? }`                                                               |
| `resolve_comment`            | Mark a comment resolved (no delete tool)                                                                                   |
| `list_artifact_comments`     | Annotations on a file artifact `{ project_id, artifact_id, include_resolved? }`                                            |
| `add_artifact_comment`       | Annotate a file artifact `{ project_id, artifact_id, body, passage?, anchor? }` (anchor = W3C selector JSON)               |
| `start_agent_run`            | Begin external agent session                                                                                               |
| `record_agent_progress`      | Append progress event                                                                                                      |
| `complete_agent_run`         | Close run (completed or failed)                                                                                            |
| `sync_pull`                  | Fetch participant submissions into the triage inbox                                                                        |
| `list_submissions`           | List pulled submissions (triage inbox)                                                                                     |
| `triage_submission`          | Accept a submission → real task (or reject)                                                                                |

46 tools in total. The last five are the [collaboration tier](/reference/collaboration/) — sharing a project with a client or team (`create_share_link` is a separate, lighter-weight primitive for handing one resource to a worker — see [Share links](#share-links) above). At session start, list tools before calling them. Resolve the project from `.plandesk/config.json` when present — do not guess IDs. To stand up a whole plan at once use `scaffold_project_from_plan`; to execute it, loop `get_next_task` → `update_task` within a Goal. There is no delete tool by design — resolve comments rather than deleting them.

### Error cases

- Unknown project → tool error `not_found`
- Invalid status enum → `invalid_argument`
- Token revoked → HTTP 401

## Factory Desk

Programmatic access without Claude/Codex: install `@plandesk/mcp-client` from npm (or use `packages/plandesk-mcp-client` from a cloned repo) with `PLANDESK_URL` and `PLANDESK_MCP_TOKEN`.
