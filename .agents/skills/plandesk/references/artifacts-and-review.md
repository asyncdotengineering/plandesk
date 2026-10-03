# Reviewing files and artifacts

## Reviewing files (the CLI previewer)

Beyond the workspace UI, a person can open any Markdown or HTML file you produced
in a local previewer and annotate it:

    plandesk <file.md>        # or: plandesk *.md, plandesk open <paths...>

They highlight text and attach notes. In a connected repo those annotations are
stored as `artifact` comments in this project's board, so you read and resolve
them over MCP exactly like document comments — `list_artifact_comments` to pull,
`resolve_comment` to close. This closes the "you write a file → the human marks it
up → you fix it" loop on files, not just documents. When you finish a deliverable
file, tell the person they can review it with `plandesk <that file>`.

## Artifacts

An artifact is a stored agent deliverable — a report, an RFC, an HTML diagram —
kept in the workspace (not a file on disk).

- `create_artifact` to store one (`title`, `content`, optional `kind`:
  `markdown` or `html`); the returned `artifact_id` is exactly the id
  `list_artifact_comments`/`add_artifact_comment` use, so a human's annotation
  and your `update_artifact` revision close the loop without a file on disk.
- `get_artifact` to read one back before revising; `list_artifacts` to check
  what a project already has before creating a duplicate.
- Prefer an artifact over a Note or Document when the deliverable is a finished
  piece meant to be read and marked up (a report, a spec, a diagram) rather than
  tracked plan state. `artifact_id` is opaque — pass through what `create_artifact`
  or `list_artifact_comments` gave you, never construct it.
