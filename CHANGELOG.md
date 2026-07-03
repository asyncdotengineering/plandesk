# Changelog

All notable changes to Plan Desk are documented here.

## [cli 0.9.0] — 2026-07-03

### Added

- **`plandesk factory init`** — scaffolds a project-local, harness-neutral agent factory workspace under `.agents/`: `factory.md` (the work-cycle contract), `protocol.md` (deterministic dispatch + result contract: probe → command template → result JSON whose claimed commands the engine re-runs; exit codes are authoritative), `workers/` (one file per worker CLI — claude, codex, cursor, grok, opencode — each with an availability `probe` and a `{prompt_file}` command template, so nothing assumes what is installed on a given machine), `lanes.md` (risk-lane policy), `verifiers/` (fast per-change checks, exit 0 = pass), a gitignored `runs/` zone for machine state, plus generated `/factory` command adapters for Claude Code and Codex. Authored policy files are created once and never overwritten on re-run (`skip`); adapters refresh every run. `--print` dry-runs, `--repo` targets another directory. Format rules documented in the new [Factory workspace](https://plandesk.asyncdot.com/reference/factory/) reference: one required `type` frontmatter field, identity from the file path, permissive consumers.

### Changed

- **Global-directory guard** — `plandesk connect` and `plandesk factory init` now refuse to write into your home directory or a global agent-config directory (`~/.claude`, `~/.codex`, `~/.agents`, `~/.config`, `~/.plandesk`). Agent artifacts written there (e.g. a `CLAUDE.md` include in `~/.claude`) leak into every project on the machine. `factory init --force` overrides deliberately.

## [cli 0.8.0 · mcp 0.7.0 · api 0.7.0] — 2026-06-14

### Added

- **Per-project port assignment** — `plandesk init` probes the `3400–3499` range and stores a free port in `.plandesk/workspace.json`. `plandesk serve` reads this port automatically, so each project runs on its own port without collision when multiple projects are active on the same machine.
- **Runtime port file** — `plandesk serve` writes `.plandesk/server.json` (gitignored) with the actual bound port and PID on startup, and deletes it on clean exit. PID-liveness filtering means a stale entry from a crashed process is ignored automatically.
- **`plandesk url` command** — prints the server URL for this project's `.plandesk/` dir: prefers `server.json` (live port), falls back to `workspace.json` (assigned port), then the default. `--lan` substitutes the first external IPv4 address for use in scripts or remote agents. Use `$(plandesk url)` instead of hardcoding `http://127.0.0.1:3847` in agent prompts and `start.md` scripts.
- **`get_task` MCP tool** — point read for a single task by ID. Useful for agents reconciling board state without listing everything.
- **`list_tasks` MCP tool** — lists all tasks for a project, optionally filtered by `status`. MCP tool count is now 29.

## [cli 0.7.0] — 2026-06-13

### Changed

- **Project-local database** — `plandesk init` now creates `.plandesk/workspace.db` in the current directory instead of the global `~/.plandesk/workspace.db`. Every project gets its own database, isolated from other projects on the same machine. `plandesk serve` (and `token`, `export`, `import`) walks up from cwd to find the nearest `.plandesk/` directory automatically — running `serve` from a connected repo just picks up the right database without any flags. Falls back to `~/.plandesk` only when no `.plandesk/` exists anywhere in the directory tree (backward compatible for existing global workspaces). The startup log now prints the resolved database path so it is always clear which database you are hitting.
- **Default bind host is now `0.0.0.0`** — `plandesk serve` binds to all interfaces by default, so other devices on the same local network (phone, tablet, another laptop) can reach the UI at your machine's LAN IP without any flags. Previously defaulted to `127.0.0.1` (loopback only). Override with `--host 127.0.0.1` or `PLANDESK_HOST` to restrict to loopback.
- **`PLANDESK_AUTH_PASSWORD` is now optional for non-loopback binding** — setting a password still enables HTTP auth on the UI and REST API, but it is no longer required to start the server. This removes the friction for local-network use on a trusted LAN. For internet-facing deployments (Docker, Fly, etc.) setting a password is still strongly recommended.

## [cli 0.6.0 · mcp 0.6.0 · api 0.6.0 · db 0.5.0] — 2026-06-11

### Added

- **Project notes** — free-form, project-scoped working notes with a rich-text (TipTap) editor and titles, kept separate from formal documents (notes are flat, not task-linked, and not part of the client share). New "Notes" tab per project lists notes and opens an editor/reader; create, edit, and delete from the UI. Notes are included in lossless export/import.
- **Note MCP tools** — `create_note`, `update_note`, `get_note`, and `list_notes` let agents capture and revise working notes for a project (Markdown bodies render as rich text). No `delete_note` — agents don't delete, by design. MCP tool count is now 27.
- **`notes` table** — added via migration `0005`; existing workspaces migrate automatically on `plandesk serve` (no data touched). Re-run `plandesk connect` to pick up the skill's new Notes guidance.

## [cli 0.5.0 · mcp 0.5.0 · api 0.5.0] — 2026-06-11

### Added

- **Zero-setup MCP token** — `plandesk connect` writes `.mcp.json` with a `headersHelper` that reads the gitignored `.plandesk/token` at connection time. No `export PLANDESK_MCP_TOKEN` step; the env var remains as an override.
- **Skill discovery** — `connect` symlinks the skill into `.claude/skills/plandesk/SKILL.md` and `.agents/skills/plandesk/SKILL.md` (folders created if missing); `skill.md` now carries SKILL.md frontmatter (`name`, `description`).
- **Claude command** — `connect` writes `.claude/commands/plandesk.md` so `/plandesk` works in Claude Code (alongside the existing Codex command).
- **Markdown document bodies** — MCP `create_document`, `update_document`, and `scaffold_project_from_plan` convert Markdown bodies to rich-text HTML; tool descriptions and the skill instruct agents to write well-structured Markdown.
- **Board task details** — kanban cards open a task-details panel on click (label, description, assignee, due date; close button); label editing moved from inline card editing into the panel. Drag-and-drop unchanged.
- **Legacy markdown rendering** — document editor, reader, and portal render plain-Markdown bodies (written before conversion existed) as rich text.

### Changed

- `.mcp.json` `plandesk` entry no longer uses a static `Authorization: Bearer ${PLANDESK_MCP_TOKEN}` header (which warned when the env var was unset and disabled OAuth fallback); re-run `plandesk connect` in existing repos to migrate.
- `plandesk disconnect` also removes the skill symlinks and the Claude command file.

## [1.0.0] — 2026-06-08

First production release — local-first, self-hostable planning workspace with MCP-native agent integration.

### Added

- **Canvas** — Flow view with task nodes, drag-and-drop layout, and labeled directed edges (`blocks`, `depends_on`, etc.).
- **Documents** — Markdown docs on nodes; nested tree; title prefixes and status lines; one-click from canvas node to editor.
- **Tasks & board** — Single SSOT for status across canvas badges and kanban columns; filterable task list.
- **SSE** — Live updates on `GET /api/v1/events` when tasks, canvas, docs, or agent runs change (MCP writes broadcast within 500 ms p95 on localhost).
- **MCP server** — Streamable HTTP at `/mcp/` with 10 tools: read (`list_projects`, `get_project`) and write (tasks, docs, edges, agent runs). Bearer token auth; tokens created in UI or CLI, revocable, stored hashed.
- **CLI** — `plandesk init`, `serve`, `token create`, `export`, `import`, `connect`, `disconnect`, `doctor`.
- **Repo connect** — `plandesk connect` writes `.plandesk/{config.json, skill.md, token}`, project-scoped `.mcp.json` with `${PLANDESK_MCP_TOKEN}`, CLAUDE.md sentinel block, and Codex command file.
- **Export/import** — Lossless `plandesk-export-v1` JSON (`plandesk export` / `plandesk import`).
- **Docker self-host** — `docker compose up` on port 3847; `PLANDESK_AUTH_PASSWORD` required for `0.0.0.0` bind.
- **Factory adapter** — `@plandesk/mcp-client` for programmatic MCP access from Factory Desk Plan mode.
- **Dogfood fixture** — `examples/checkout-revamp.json` sample project.
- **Validation & metrics** — `pnpm validate`, `pnpm metrics`; RFC §9 assertions and §1 targets measured in `METRICS.md`.

### Documentation

- Top-level README (quickstart, Docker, agent connect, CLI reference).
- [apps/docs](apps/docs/) — Astro Starlight documentation site (MCP setup, agent skill, CLI/API reference).
