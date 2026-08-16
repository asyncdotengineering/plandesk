---
title: Self-host Plan Desk for your team
description: Stand up your own always-on Plan Desk instance, invite teammates, and connect everyone's repos.
---

If your team wants a shared, always-on planning server behind your own firewall and TLS — with data in a database you back up, and no dependency on a vendor's hosted instance — self-hosting is the [self-host topology](/self-hosting/topologies/#2-self-host--your-server-your-database). You run the same open-source server asyncdot runs; you just own the box and the database.

If you'd rather skip infrastructure entirely, use the managed instance instead — see [Take a local board online](./going-online/).

## 1. Stand up the server

Two supported paths — pick one:

**Docker, single box:**

```bash
export PLANDESK_AUTH_PASSWORD='choose-a-strong-password'
docker compose -f docker-compose.hosted.yml up --build
```

By default this persists to a local SQLite file on a Docker volume. For a durable, shared database, point it at your own libSQL/Turso database instead and apply the schema once — see [Docker (self-host)](/self-hosting/docker/) for the full flow.

**Cloudflare Workers + Turso:**

For a public HTTPS API without running a long-lived VM, deploy to the edge — see [Cloudflare Workers](/self-hosting/cloudflare/) for the complete runbook (secrets, R2, `wrangler deploy`).

Either way, if you're pointing at a remote database, you — the operator — run the schema migration once, and again on upgrades:

```bash
plandesk migrate --db <url> --db-token <token>
```

The server never auto-migrates a remote database, so a multi-replica deploy never races on the schema.

### GitHub sign-in

GitHub sign-in is optional but recommended for a team — without it, the dashboard falls back to token entry only. Create a GitHub OAuth App and set its callback URL to:

```
<your-base-url>/api/auth/callback/github
```

Full steps (client id/secret, Wrangler secrets): [Cloudflare Workers — step 2](/self-hosting/cloudflare/#2-github-oauth-app-optional).

## 2. Invite your team

There's no dashboard "Invite member" button yet — invitations today are link-only: you create one via the API, and you deliver the claim link to your teammate by hand (Slack, email, whatever). A dashboard invite flow is a planned improvement, not yet shipped.

**Bootstrapping the very first owner.** On a fresh instance with no GitHub sign-in yet, mint the first owner invitation from the shell:

```bash
plandesk admin invite-owner --email <you@example.com>
```

This prints a claim link. Open it and it walks you through claiming ownership of the default organization.

**Inviting a teammate once you have an owner session.** This endpoint requires a signed-in owner's browser session (not a CLI/agent token), so call it with your dashboard session cookie attached — from a script, or your browser's dev tools:

```bash
curl -X POST "<your-base-url>/api/v1/orgs/<org-id>/invitations" \
  -H "Content-Type: application/json" \
  --cookie "<your dashboard session cookie>" \
  -d '{"email": "teammate@example.com", "role": "member"}'
```

`role` is `owner`, `admin`, or `member`. The response includes a `claimUrl` — send that link to your teammate directly. No email is sent by Plan Desk.

Your teammate opens the claim link, signs in with GitHub, and accepts — they're now a member (or whatever role you invited them as) of your organization.

## 3. Teammates switch to the shared org

A teammate signing in for the first time gets their own personal organization automatically, same as anyone else. Once they've accepted your invite, they switch into your team's org using the **organization switcher** in the dashboard's account menu (top right, next to their role badge) — it lists every org they belong to and lets them pick.

## 4. Everyone connects their repos

Each teammate, in each repo they work in:

```bash
plandesk login --server <your-instance-url>
```

Paste their own CLI token (from **Settings → MCP → Generate CLI token**, on the team org). Then, per repo:

```bash
plandesk connect --to <team-org-id> [--project <name>]
```

This mints that person's agent a project-scoped key — never their owner key — written to `.plandesk/token`. Full grammar and the two-actor model: [Take a local board online](./going-online/#5-bind-the-repo-for-your-agent) and [CLI Reference](/reference/cli/#hosted-login-and-connect-two-actor).

## Roles

| Role     | Can do                                                            |
| -------- | ----------------------------------------------------------------- |
| `owner`  | Everything, including minting CLI/agent keys and inviting members |
| `admin`  | Manage projects                                                   |
| `member` | Work with content — tasks, documents, notes                       |

## Next

- [Take a local board online](./going-online/) — the promotion flow (`push`, `connect`) this guide's step 4 builds on.
- [Deployment topologies](/self-hosting/topologies/) — how self-host compares to local and managed.
- [Collaboration & sync](/reference/collaboration/) — sharing a plan externally with a client, separate from team membership.
