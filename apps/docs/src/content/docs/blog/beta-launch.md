---
title: 'Beta launch log: from local-first to a hosted control plane'
description: The Plan Desk 1.0.0-beta.1 launch — what shipped, and the real bugs we hit deploying it. A running log we update as we learn.
---

_A running log of the 1.0.0-beta.1 launch. We update it as we go — including the things that broke._

## What this beta is

Plan Desk started as a local-first planning workspace: a task-graph on your machine, an MCP server your coding agent drives, zero accounts, zero cloud. That's still the default and always will be. **1.0.0-beta.1** adds the other half — a **hosted control plane** so a team can share a board online — without giving up the local-first promise.

The headline changes:

- **Auth is now 100% [better-auth](https://better-auth.com).** GitHub social sign-in for the dashboard, a paste-a-token flow for the CLI, and project-scoped keys for agents. The old hand-rolled token table, device-code login, and sessions are gone.
- **Two-actor model.** A human provisions access (owner key); an agent inherits a scoped key and never logs in.
- **A real migration path.** The schema was reset for this rewrite, so `plandesk legacy-upgrade` lifts an old board into the new one — one command, nothing lost.

Install the beta:

```bash
npm i -g @plandesk/cli@beta
```

Your existing `@latest` install is untouched — the beta ships under the `beta` npm tag.

## Shipping it: what actually broke

We deployed the hosted API to **Cloudflare Workers + Turso** as part of this launch. "It built in CI and passed a dry-run" is not the same as "it runs on the edge." Deploying for real surfaced three genuine bugs — all of them the kind you only find by doing it:

1. **`fileURLToPath(import.meta.url)` at module load.** A few modules resolved a package path at import time (to read a version, to find the migrations folder). The Workers runtime can't resolve `import.meta.url` to a filesystem path, so the Worker threw _"path argument must be… Received undefined"_ on every deploy — before running a single line of our logic. Fix: make those lazy, so they only run when actually called (which, on the Worker, is never).
2. **Storage hard-required S3 credentials.** The Worker entry unconditionally constructed the S3/R2 adapter and threw if the creds were missing. That's wrong — file storage is optional; the planning core doesn't need it. Fix: only wire storage when its credentials are present, exactly like `plandesk serve` already did.
3. **An SPA redirect loop.** The web build ships a `_redirects` file (`/* /index.html 200`) for Netlify/Pages-style hosts. On Workers, `not_found_handling = "single-page-application"` already does that — having both created an infinite-loop rule Cloudflare rejects.

None were caught by the test suite or `wrangler --dry-run`, because they're **runtime/edge** failures. The lesson, again: production is the only place some things are learned. All three are fixed and roll into `beta.2`.

A couple of smaller learnings:

- **Turso wants an explicit `--group`** if you have more than one.
- **Bootstrapping the first owner** on a token-only hosted instance (no GitHub yet) has no self-serve path — we created it directly against the database. A `plandesk admin invite-owner --db <remote>` is the proper fix, and it's on the list.

## Where it stands

The hosted instance is live and the full stack is proven end to end: sign a request with an owner key → it resolves to `owner` through the live-role ceiling → create a project → it persists to Turso. Auth-gated, better-auth-wired, SPA served.

**Still to come before public GA:** GitHub sign-in on the hosted deploy (it's token-only today), R2 file storage, a dashboard invite UI (invites are link-only right now), observability, and rate limiting. Those are the honest gaps — see the launch roadmap.

## Next entries

We'll append here as the beta proves out — GitHub sign-in going live, the first external testers, whatever else breaks. That's the point of a beta.
