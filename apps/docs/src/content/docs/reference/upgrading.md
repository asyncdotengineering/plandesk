---
title: Upgrading
description: Upgrade the Plan Desk CLI, server, and connected repos to the latest version.
---

Plan Desk ships as one npm package: `@plandesk/cli` contains the CLI, the server (`plandesk serve`), the MCP tools, and the web UI. Your data lives in `~/.plandesk` and is migrated automatically — upgrading never touches it.

## 1. Update the package

```bash
npm i -g @plandesk/cli@latest
plandesk version   # confirm (also: plandesk --version)
```

## 2. Restart the server

Stop the running `plandesk serve` and start it again. The new server runs database migrations on startup and serves the updated web UI and MCP tools.

```bash
plandesk serve
```

## 3. Re-connect each repo

`plandesk connect` **is the upgrade command** for a repo: it is idempotent, reads the existing binding from `.plandesk/config.json`, reuses your token, and regenerates every artifact to the current version — `.mcp.json`, `.plandesk/skill.md`, the skill symlinks, the agent command files, and the `CLAUDE.md`/`AGENTS.md` sentinel block.

```bash
cd /path/to/your/repo
plandesk connect
```

Then start a **new** agent session so MCP tools and the skill reload.

## 4. Verify

```bash
plandesk doctor --repo .
```

Checks the workspace DB, the binding, the token, and that the MCP server lists its tools.

## Version notes

### 0.11.x

Latest: `@plandesk/cli@0.11.0` (depends on `@plandesk/api@0.10.0`, `@plandesk/db@0.8.0`, `@plandesk/mcp@0.10.0`). Upgrade with `npm i -g @plandesk/cli@latest`; restart `plandesk serve` — schema migrations run automatically on load (no manual migrate step). Back up `<data-dir>/workspace.db` before upgrading if you want a rollback point.

- **Goals** — a new **Goals** tab per project holds goal-altitude nodes. Every task now belongs to a Goal (`tasks.goal_id`, NOT NULL); new projects get a default **General** goal. Agents gain `create_goal`, `get_goal`, `list_goals`, `pause_goal`, `resume_goal`, and `complete_goal`. `get_next_task` walks the active Goal's frontier (optional `goal_id`; new reasons `no_active_goal`, `multiple_active_goals`). `create_task` accepts an optional `goal_id`.
- **Generalized comments** — comments are polymorphic (`target_type` + `target_id` on documents, tasks, notes, and submissions). `add_comment` now takes `{ target_type, target_id, body, passage? }`; `list_comments` takes `{ project_id, target_type?, target_id?, include_resolved? }`. The old document-only `document_comments` table is replaced by a single `comments` table. Migrations apply automatically on server start.
- **MCP tool count** — the server now lists **38 tools**. Re-run `plandesk connect` and start a new agent session so the tools and skill reload.

### 0.6.x

- **Project notes** — a new per-project **Notes** tab holds free-form, rich-text working notes, separate from documents (notes are flat, not linked to tasks, and not part of the client share). The `notes` table is added by migration `0005` and applies automatically when the upgraded server starts — your data is untouched and no manual step is needed.
- **Note MCP tools** — agents gain `create_note`, `update_note`, `get_note`, and `list_notes` (there is no `delete_note` — agents don't delete, by design). The MCP server now lists **27 tools**. Re-run `plandesk connect` and start a new agent session so the tools and the skill's new Notes section reload.

### 0.5.x

- **Zero-setup token** — `.mcp.json` no longer uses a static `Authorization: Bearer ${PLANDESK_MCP_TOKEN}` header (which warned when the env var was unset). The regenerated entry reads `.plandesk/token` automatically via a `headersHelper`; you can stop exporting `PLANDESK_MCP_TOKEN` (it still works as an override). **Re-running `connect` is required** to migrate the old entry.
- **Skill discovery** — `connect` now also installs the skill at `.claude/skills/plandesk/` and `.agents/skills/plandesk/` (symlinks to `.plandesk/skill.md`) and a `/plandesk` command at `.claude/commands/plandesk.md`. Commit these alongside the rest.
- **Markdown documents** — agents can write document bodies as Markdown; the MCP server converts them to rich text. Documents written as Markdown _before_ 0.5.0 render correctly in the updated web UI without changes.
- **Skill conventions** — the regenerated `.plandesk/skill.md` adds the "Keeping the board true" rules (atomic status updates, board↔reality reconciliation). If you customized your skill file, re-apply your edits after `connect` rewrites it.

## Pinned or npx installs

If you run Plan Desk without a global install, `npx @plandesk/cli@latest …` always uses the newest version — only steps 2–4 apply.
