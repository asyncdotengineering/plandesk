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

Hosted instances can support `plandesk login`, which uses the server's GitHub device flow and stores only a Plan Desk token locally. Self-hosted instances without a GitHub app continue to use pasted Plan Desk tokens. Each hosted organization is isolated; an object belonging to another organization returns 404.
