---
title: Plan → share → build
description: Promote a project, share a read-only hosted view, and bring moderated participant feedback back into the plan.
---

Plan Desk collaboration keeps authoring local while the hosted portal exposes a read-only, allow-listed view. Organizations, members, roles, and cross-organization isolation are enforced by the hosted server.

## The collaboration loop

1. Promote the local project to its hosted organization:

   ```bash
   plandesk push --to <org-id>
   ```

2. Create a share link:

   ```bash
   plandesk share create --audience "Acme" --public --allow-submit
   ```

3. Participants open the link. The portal computes the read-only view live from the hosted project and polls for updates. Internal data and edit access are not exposed.

4. Participants file feedback into the moderated submission inbox. Submissions do not change the source plan.

5. Pull submissions into the local triage inbox:

   ```bash
   plandesk pull
   ```

6. Review and run `triage_submission` to accept, reject, or connect a submission to a task. Accepted feedback enters the normal task workflow, where the agent can build it.

## What participants can see

The shared projection is an explicit allow-list of the hosted project's shared graph, board, and documents. It is read-only. A public or invite-scoped link can permit named participants to submit issues, but submission is always moderated before it becomes a task.

## Authentication and tenancy

Hosted auth is **better-auth**, two-actor for the CLI:

1. **Human** signs into the dashboard (GitHub social when configured) and **Generate CLI token** (org-wide owner API key).
2. **Human** runs `plandesk login` (or `plandesk login --server <url>`) and pastes that key into `~/.plandesk/config.json`.
3. **Agent** (or human) runs `plandesk connect --to <org>` to mint a project-scoped agent key into `.plandesk/token`.

Agents never log in. Each hosted organization is isolated (`organization` / `member` in better-auth); an object belonging to another organization returns 404.
