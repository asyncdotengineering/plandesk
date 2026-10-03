---
title: Self-host Plan Desk for your team
description: Stand up your own always-on Plan Desk instance, invite teammates, and connect everyone's repos.
---

If your team wants a shared, always-on planning server behind your own firewall and TLS, with data in a database you back up, self-host it. You run the same open-source server you run locally; you own the box and the database. Compare the targets in [Deployment topologies](/self-hosting/topologies/).

## 1. Stand up the server

Pick one:

- **[Docker](/self-hosting/docker/)**, single box: `cp .env.example .env`, fill it in, `docker compose up --build -d`. SQLite on a volume by default, or your own libSQL/Turso database.
- **[Cloudflare Workers](/self-hosting/cloudflare/)**: public HTTPS without a machine. Turso for the database, R2 for files.
- **[Vercel](/self-hosting/vercel/)**: one function plus static output. Turso for the database.

Each has a Deploy button or one command, and `plandesk deploy <docker|cloudflare|vercel>` prints a version your coding agent can run. There is no migrate step: the server prepares its own database on first start ([how](/self-hosting/topologies/#the-server-prepares-its-own-database)). Set `PLANDESK_BASE_URL` to the board's public origin.

### GitHub sign-in

GitHub sign-in is optional but recommended for a team — without it, the dashboard falls back to token entry only. Create a GitHub OAuth App and set its callback URL to:

```
<your-base-url>/api/auth/callback/github
```

Set `PLANDESK_GITHUB_CLIENT_ID`, `PLANDESK_GITHUB_CLIENT_SECRET` and `PLANDESK_GITHUB_CALLBACK_URL` together on the server; see [Server configuration](/self-hosting/server-config/#environment-variables).

## 2. Invite your team

There's no dashboard "Invite member" button yet — invitations today are link-only: you create one via the API, and you deliver the claim link to your teammate by hand (Slack, email, whatever). A dashboard invite flow is a planned improvement, not yet shipped.

**Bootstrapping the very first owner.** On a fresh instance with no GitHub sign-in yet, mint the first owner invitation from the shell. Against a remote database (Workers, Vercel, or Docker with `PLANDESK_DB_URL`), pass the database and the deployment's secret; the server must have started once so the database is prepared:

```bash
plandesk admin invite-owner --email <you@example.com> \
  --db "$PLANDESK_DB_URL" --db-token "$PLANDESK_DB_TOKEN" --secret "$PLANDESK_BETTER_AUTH_SECRET"
```

For Docker with the default file database, run it inside the container instead: `docker compose run --rm plandesk admin invite-owner --email <you@example.com>`.

This prints a claim link. If it starts with `http://127.0.0.1`, replace that origin with your `PLANDESK_BASE_URL`. Open it and it walks you through claiming ownership of the default organization.

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
- [Deployment topologies](/self-hosting/topologies/) — local vs. self-hosted, and how the database is prepared.
- [Collaboration & sync](/reference/collaboration/) — sharing a plan externally with a client, separate from team membership.
