---
title: Troubleshooting
description: Common symptoms and their fixes — agent setup, collaboration commands, deploy, and the server.
---

Most issues are one of a handful of things. Find your symptom; each fix is the real cause, not a workaround.

## Agent & MCP setup

**Claude Code doesn't show Plan Desk's tools.** The MCP server is registered per session — adding it doesn't affect the running one. Start a **new** Claude Code session after `claude mcp add`. Verify with `claude mcp list`, and confirm Plan Desk is serving (`plandesk serve` running, UI reachable at `http://127.0.0.1:3847`). Auth errors only apply to hosted orgs (local loopback needs no token) — re-run `plandesk connect --to <org>` for a fresh scoped agent key and re-add the server with the new `Authorization: Bearer …` header.

**The agent can't find or resolve the project.** From the repo, run `plandesk connect --project "<name>"` so `.plandesk/config.json` exists, then start a **new** session — `.mcp.json` reads the token from `.plandesk/token` automatically. The skill file and binding let the agent resolve the project without being told the id.

**`doctor` to diagnose.** `plandesk doctor --repo .` checks DB health, the binding, and MCP reachability in one shot. Run it first when something's off.

## Sync & collaboration commands

These fail loudly with the exact next step — here's what each means:

**`Missing .plandesk/config.json. Run plandesk connect first.`** The collaboration commands operate on a connected project. Run `plandesk connect --project "<name>"` before `publish` / `push` / `pull` / `share`.

**`Sync server URL is required.`** / **`Remote URL is required.`** The project is not configured for a hosted API. Log in with `plandesk login --server https://<your-plandesk-api>`, then promote with `plandesk push --to <org-id>`.

**`Global project id is required. Run plandesk publish …`** Same cause — `publish` first; `push`/`pull` need the global id it records.

**`Sync token is required. Set PLANDESK_SYNC_TOKEN, write .plandesk/sync-token, or pass --sync-token.`** A legacy remote pull credential is missing. For single-server hosted work (owner and portal on the same API), triage submissions on that API directly — you do not need a separate sync-server token. Prefer `plandesk login` + org token for hosted promote.

**`push` reports `pushed 0 share(s)`.** There's no share to project. Create one: `plandesk share create --audience "<name>" --public`. Then `push` again.

## The portal

**The share link shows "Loading…" forever.** The portal can't get the view. Check, in order:

1. **Nothing was promoted yet** — run `plandesk push --to <org-id>` so the hosted project exists for that share.
2. **Wrong API origin** — the portal calls the same origin (or `VITE_API_URL` at build time). Point it at the Plan Desk API that holds the share, not a removed sync-server URL.
3. **No guest session** — open the share, join with a name; view and submissions require a guest session (401 without one).
4. **Token revoked or expired** — a share past its `--expires` window, or revoked, returns 401. Mint a fresh share.

## Deploy

**`plandesk deploy <target>` says the guide is "unavailable" (or 404).** The CLI fetches the guide from the docs site. Either the target name is wrong — run `plandesk deploy` with no argument to list valid targets (`cloudflare`, `fly`, `docker`) — or the docs site hasn't published that guide yet. The error prints the exact URL; open it directly to confirm.

**Unknown deploy target.** Run `plandesk deploy` to see the list. Point a coding agent at one with `plandesk deploy cloudflare | claude`.

## The server

**Port already in use.** One global board → one port. If `plandesk serve` reports the port is already in use, another Plan Desk server is already bound there (or something else is). Stop the other process, or pass `--port <n>` for a different bind. There is no auto-rotation — connected agents expect a stable URL.

**`Database appears corrupt or unreadable.`** Run `plandesk doctor` to diagnose. The default board is `~/.plandesk/workspace.db`; a repo-local `.plandesk/workspace.db` is used only if it already exists. `plandesk serve` prints the exact path it resolved on startup. Override with `--data-dir` or `PLANDESK_DATA_DIR`.

## Still stuck?

Open an issue with the exact command, the full error, and `plandesk doctor --repo .` output: [github.com/asyncdotengineering/plandesk](https://github.com/asyncdotengineering/plandesk/issues).
