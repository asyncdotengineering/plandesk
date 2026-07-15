---
title: Self-hosting the sync server
description: Deploy a Plan Desk hosted control plane for project promotion and moderated sharing.
---

The sync server stores hosted projects and serves the collaboration API. A share link is a read-only view computed from the hosted project at request time; the portal polls for updates. It is not a second editable workspace.

## Configure authentication

Self-hosting does not require a GitHub app. Without GitHub configuration, `/api/v1/auth/methods` reports token entry and device endpoints return 404. Owners can create a Plan Desk token and use it with the CLI.

If GitHub is configured for the hosted instance, `plandesk login --server <url>` starts the server-side GitHub device flow. The CLI never contacts GitHub and never receives the GitHub access token.

## Promote and share

After deploying and migrating the database, configure the CLI's server URL and token, then promote to an organization:

```bash
plandesk login --server https://your-host.example
plandesk push --to <org-id>
plandesk share create --audience "Acme" --public --allow-submit
```

Participants submit through the portal. Pull their submissions to local storage and triage them before they become tasks:

```bash
plandesk pull
```

Keep the Plan Desk token and any database credentials in the runtime environment or ignored local files. Do not commit them.
