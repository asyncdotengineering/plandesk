# Changelog

All notable changes to Plan Desk are documented here.

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
