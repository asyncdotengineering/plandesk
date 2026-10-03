# Plan Desk server setup

New to this repo? Run `plandesk onboard` for the full Plan Desk + Factory model
(how the board works, the execution loop, delegation, and the MCP tools).

### Server must be running (machine-global — not the harness)

MCP tools talk to a **Plan Desk server on the user's machine** (`plandesk serve`).
That process must outlive the agent session. **Do not** start it with the harness
Shell tool's `run_in_background` — that ties the server to this chat and it dies
when the session ends. Start it **globally on the machine**: a detached OS
process the user (or a one-shot setup shell) owns.

**Check first** (from the repo root):

```bash
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "Plan Desk server is up" \
  || echo "No server — start one (below)"
```

`plandesk status` also reports whether a board on this machine is running (by
PID liveness, not just a stale lock file).

**If down, start detached** (survives after the agent's shell exits):

```bash
plandesk serve >>/tmp/plandesk.log 2>&1 &
disown
sleep 2
curl -fsS "$(plandesk url)/api/v1/projects" >/dev/null 2>&1 \
  && echo "server up" \
  || (echo "not ready — check /tmp/plandesk.log"; tail -20 /tmp/plandesk.log)
```

Tell the user the server is running in the background and that **`plandesk serve`
in a dedicated terminal** is better for day-to-day use (logs stay visible; no
dependency on this session). There is no `plandesk start` — the command is
**`plandesk serve`**.

**First time on this machine** (before serve will work): `npm i -g @plandesk/cli@latest`
(Node ≥ 20), then `plandesk init` (idempotent — creates `~/.plandesk` unless the
repo already has a local `.plandesk/workspace.db`). Full walkthrough:
`plandesk onboard`, or fetch `https://plandesk.asyncdot.com/start.md`.

**Repo not bound yet?** After the server is up, run **`plandesk connect`** from
the repo root — it writes `.plandesk/config.json` and wires MCP. That is setup,
not planning; do not scaffold a second project if the repo is already bound.

**MCP tools still missing after the server is up?** The MCP client loads tools at
**session start** — ask the user to start a **new** agent session (or re-add the
MCP server) once serve and connect are done.
