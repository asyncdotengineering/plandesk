# Changelog

All notable changes to Plan Desk are documented here.

## [0.13.2] — 2026-07-06

### Added

- **Folder support in the previewer** — `plandesk ./dir` opens every previewable file in a folder as tabs (walked recursively). A folder of linked HTML (an RFC or exported site with relative `<img>`/`<link>`/`<a href>` to sibling files and assets) now **renders with those assets and links working**: the opened directory is served as a scoped, same-origin static root, and folder HTML is framed `sandbox="allow-same-origin"` **without** `allow-scripts` (safe for static docs) under a `default-src 'none'; img-src 'self'…; script-src 'none'; connect-src 'none'` policy. Path traversal outside the folder is blocked. Single-file previews (`plandesk file.html`) are unchanged — a lone HTML file is still treated as a self-contained, `allow-scripts`, network-dead artifact.



### Changed

- **Unified versioning** — all published packages (`@plandesk/db`, `api`, `mcp`, `cli`, `mcp-client`, `sync-server`) now share a single version, starting at **0.13.1**. Future releases bump them in lockstep. (Internal `workspace:*` deps are rewritten to the exact version on publish — no workspace references ship in the tarballs.)

### Added

- **Agent awareness of the file previewer** — the connect skill (`.plandesk/skill.md`) now tells your coding agent about the `plandesk <file.md>` previewer/annotator and how to read file annotations over MCP (`list_artifact_comments` → `resolve_comment`), closing the "you write a file → the human marks it up → you fix it" loop on files. Re-run `plandesk connect` to pick up the new skill section.

## [cli 0.13.0] — 2026-07-06

### Added

- **Rich previewer rendering** — the `plandesk <file.md>` previewer now renders fenced code with **syntax highlighting** (Shiki, dual light/dark, done at render time so the reader iframe stays script-free), **Mermaid diagrams** (```mermaid``` blocks render to real diagrams), and **styled GFM tables**. Mermaid runs in the previewer's parent page and injects static SVG into the sandboxed, network-dead reader iframe — nothing executes inside the reader. The Mermaid bundle is served locally and **lazy-loaded only when a diagram is present**, so files without diagrams are unaffected.

### Changed

- **Previewer rebuilt on Hono + hono/jsx** — the local preview server now uses Hono routing and `hono/jsx` server-rendered components (matching the rest of the codebase), replacing the previous hand-rolled `node:http` server. No behavior change to the previewer's URLs, security model (sandboxed iframes + network-dead CSP), or annotation flow.

### Note

- Installing the CLI now pulls **Mermaid** as a dependency, so `@plandesk/cli` is larger on disk. It is only loaded in the browser when you preview a file containing a diagram.

## [cli 0.12.0 · mcp 0.11.0 · api 0.11.0 · db 0.9.0] — 2026-07-06

### Added

- **Artifacts + planannotator** — `plandesk <file.md>` / `plandesk <file.html>` (glob-friendly: `plandesk *.md`) opens a local browser previewer that renders agent-generated Markdown and self-contained HTML **the way a Claude artifact renders** — sandboxed and network-dead — and lets you **highlight text and attach annotations** that persist against the file. Also `plandesk open|preview|annotate <paths…>`.
  - **Rendering & isolation.** Markdown is rendered (via `marked`) inside a `sandbox="allow-same-origin"` iframe with **no** `allow-scripts` — so injected scripts can never execute (no sanitizer needed) yet the page can annotate the text. Self-contained HTML artifacts render inside `sandbox="allow-scripts"` (no same-origin) under a network-dead CSP (`connect-src 'none'`, sent as a header **and** injected as a `<meta>` that survives JS tampering). Only the files you explicitly open are served (allowlist, no traversal). Multiple files open as tabs.
  - **Annotate.** Select text → "Add note" → the note (with a W3C text-quote + position selector) is saved and listed in a side rail; resolve it, or click it to jump to the passage. Annotations **persist and re-open**: keyed by the file's path with a content hash to flag drift.
  - **Agent loop on files.** In a **connected repo**, annotations route to the workspace DB via the artifact-comments API, so your coding agent reads and resolves them over MCP — the same "you mark, the agent resolves" loop plandesk already has for documents, now pointed at any file the agent wrote. Standalone (no workspace), annotations persist to a local sidecar under `~/.plandesk/annotations/`.
- **`artifact` comment target + `anchor` column (db 0.9.0)** — the polymorphic `comments` table gains a nullable `anchor` (W3C selector JSON) and `artifact` becomes a first-class comment target. Migration `0011`; reversible.
- **Artifact-comment REST (api 0.11.0)** — project-scoped `POST`/`GET /projects/:id/artifact-comments` (the file identity travels in the body/query, so it survives slashes); `serializeComment` now emits `anchor`.
- **`add_artifact_comment` / `list_artifact_comments` MCP tools** — agents read and create file annotations. **MCP tool count is now 40** (was 38).

## [cli 0.9.1] — 2026-07-03

### Added

- **Factory policy is always-on** — `factory init` now manages a `<!-- plandesk-factory -->` include block in the repo's `CLAUDE.md`/`AGENTS.md` loading `workflow.md` + `factory.md`, so the orchestrator's program and contract ride in default context (policy gates behavior; dispatch data — protocol, workers, lanes, verifiers — stays on-demand). Idempotent; the global-dir guard still applies.
- **`workflow.md` in the factory scaffold** — the orchestrator's session program (orient → intake → execute → finish), shipped as an editable default alongside the `factory.md` per-item contract. The generated agent conventions now carry a one-line pointer ("if `.agents/factory/workflow.md` exists, follow it when executing the plan"), and the `/factory` command loads both files. Authored/create-once like all factory policy; re-run `plandesk connect` to pick up the pointer in existing repos.

## [cli 0.9.0 · mcp 0.8.0 · api 0.8.0 · db 0.6.0 · sync-server 0.5.0] — 2026-07-03

### Added

- **`plandesk factory init`** — scaffolds a project-local, harness-neutral agent factory workspace under `.agents/`: `factory.md` (the work-cycle contract), `protocol.md` (deterministic dispatch + result contract: probe → command template → result JSON whose claimed commands the engine re-runs; exit codes are authoritative), `workers/` (one file per worker CLI — claude, codex, cursor, grok, opencode — each with an availability `probe` and a `{prompt_file}` command template, so nothing assumes what is installed on a given machine), `lanes.md` (risk-lane policy), `verifiers/` (fast per-change checks, exit 0 = pass), a gitignored `runs/` zone for machine state, plus generated `/factory` command adapters for Claude Code and Codex. Authored policy files are created once and never overwritten on re-run (`skip`); adapters refresh every run. `--print` dry-runs, `--repo` targets another directory. Format rules documented in the new [Factory workspace](https://plandesk.asyncdot.com/reference/factory/) reference: one required `type` frontmatter field, identity from the file path, permissive consumers.

- **Document folders (#7)** — organize documents into nested folders: `folder` entity with cycle-safe re-parenting, documents carry an optional `folder_id`, new MCP tools `create_folder` / `update_folder`, `list_documents` returns the folder tree and filters by `folder_id`, and the documents panel renders a collapsible tree with create/rename/move (folder deletion re-homes children — nothing is orphaned). Folders round-trip through export/import.
- **Task tags (#8)** — label and filter the board: `tag` entity (name unique per project, optional color) with a task↔tag join, `create_task`/`update_task` accept `tags` (update replaces the set; unknown names auto-create), `list_tasks`/`get_next_task` filter by tags (OR semantics), new `list_tags` tool, tag chips + multi-select OR filter on the board, rename propagates everywhere, delete cascades the join. Tags round-trip through export/import.
- **MCP tool count is now 32** (was 29): + `create_folder`, `update_folder`, `list_tags`.

### Fixed

- **No more stray `workspace.db`** (#4) — commands that read a workspace (`export`, `publish`, `push`, `pull`, `share`, `token`) no longer auto-create an empty database when none exists; they fail with guidance that names the connect binding's server when one is present. Only `plandesk init` creates a workspace.
- **Unknown share token returns 404** (#4) — the sync server's `GET /shares/:token/meta` now answers 404 for a nonexistent share (was 401), matching the deploy guide's documented sanity check.
- **Deploy guide works for CLI-only installs** (#4) — explicit step-0 clone-at-matching-tag for users without a source checkout, and all remote `wrangler d1 execute` commands are non-interactive (`-y`).
- **MCP publish flow is discoverable** (#4) — `sync_push` / `publish_project` errors and descriptions now point at the CLI deploy/publish happy path.
- **Stale docs corrected** (#5) — MCP tool counts unified (the API reference was missing `get_task`/`list_tasks` entirely), and `plandesk help` no longer contradicts itself about the port default (per-project 3400–3499 vs the 3847 legacy fallback).

### Changed

- **`serve` binds `127.0.0.1` by default** (#5) — a single-user local tool must not expose its token-gated API to the whole LAN silently. LAN exposure is an explicit opt-in: `--host 0.0.0.0` or `PLANDESK_HOST`. (Reverses the 0.7.0 default.)
- **`start.md` scaffolds the factory by default** — the standard agent setup now runs `plandesk factory init` as step 5, so every connected repo gets its portable `.agents/` operating policy unless the user opts out.
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
