---
title: Troubleshooting
description: Common symptoms and their fixes — agent setup, the sync/collaboration commands, deploy, and the server.
---

Most issues are one of a handful of things. Find your symptom; each fix is the real cause, not a workaround.

## Agent & MCP setup

**Claude Code doesn't show Plan Desk's tools.** The MCP server is registered per session — adding it doesn't affect the running one. Start a **new** Claude Code session after `claude mcp add`. Verify with `claude mcp list`, and confirm Plan Desk is serving (`plandesk serve` running, UI reachable at `http://127.0.0.1:3847`). If the token is wrong you'll get auth errors — recreate it with `plandesk token create` and re-add the server with the new `Authorization: Bearer …` header.

**The agent can't find or resolve the project.** From the repo, run `plandesk connect --project "<name>"` so `.plandesk/config.json` exists, then start a **new** session — `.mcp.json` reads the token from `.plandesk/token` automatically. The skill file and binding let the agent resolve the project without being told the id.

**`doctor` to diagnose.** `plandesk doctor --repo .` checks DB health, the binding, and MCP reachability in one shot. Run it first when something's off.

## Sync & collaboration commands

These fail loudly with the exact next step — here's what each means:

**`Missing .plandesk/config.json. Run plandesk connect first.`** The collaboration commands operate on a connected project. Run `plandesk connect --project "<name>"` before `publish` / `push` / `pull` / `share`.

**`Sync server URL is required.`** / **`Remote URL is required.`** The project is not configured for a hosted server. Log in with `plandesk login --server https://<your-sync-server>`, then promote with `plandesk push --to <org-id>`.

**`Global project id is required. Run plandesk publish …`** Same cause — `publish` first; `push`/`pull` need the global id it records.

**`Sync token is required. Set PLANDESK_SYNC_TOKEN, write .plandesk/sync-token, or pass --sync-token.`** The owner sync token isn't present. `plandesk deploy` writes it to git-ignored `.plandesk/sync-token` automatically; if you self-host, [mint one yourself](/self-hosting/sync-server/#mint-an-owner-sync-token). Never commit it.

**`push` reports `pushed 0 share(s)`.** There's no share to project. Create one: `plandesk share create --audience "<name>" --public`. Then `push` again.

## The portal

**The share link shows "Loading…" forever.** The portal can't get the projection. Check, in order:

1. **Nothing was pushed yet** — run `plandesk push --to <org-id>` so the hosted project exists for that share.
2. **Wrong sync URL** — the portal is built with `VITE_SYNC_URL` baked in; if it points at the wrong server it can't fetch. Rebuild the portal against the correct sync server URL.
3. **Token revoked or expired** — a share past its `--expires` window, or revoked, returns 401. Mint a fresh share.
4. **CORS** — a self-hosted sync server must allow the portal's origin (the bundled server enables CORS on `/api/portal/*`; a custom reverse proxy must not strip it).

## Deploy

**`plandesk deploy <target>` says the guide is "unavailable" (or 404).** The CLI fetches the guide from the docs site. Either the target name is wrong — run `plandesk deploy` with no argument to list valid targets (`cloudflare`, `fly`, `docker`) — or the docs site hasn't published that guide yet. The error prints the exact URL; open it directly to confirm.

**Unknown deploy target.** Run `plandesk deploy` to see the list. Point a coding agent at one with `plandesk deploy cloudflare | claude`.

## The server

**Port already in use.** `plandesk serve` **auto-rotates** to the next free port (3847 → 3848 → …, Vite/Expo-style) and prints the URL it actually started on — so it just works. One caveat: an agent you connected with `plandesk connect` expects the original port (3847); if `serve` rotated, either stop the other process on 3847 or reconnect with `--url http://127.0.0.1:<actual-port>`. Use `plandesk serve --strict-port` to fail instead of rotating. The **sync server** does not rotate — give it a free `PORT` explicitly.

**`Database appears corrupt or unreadable.`** Run `plandesk doctor` to diagnose. The workspace DB lives in `.plandesk/workspace.db` relative to the project directory. `plandesk serve` prints the exact path it resolved on startup — check that line if you're unsure which database you're hitting. Override with `--data-dir` or `PLANDESK_DATA_DIR`.

## Still stuck?

Open an issue with the exact command, the full error, and `plandesk doctor --repo .` output: [github.com/asyncdotengineering/plandesk](https://github.com/asyncdotengineering/plandesk/issues).
