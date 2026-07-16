// `plandesk onboard` — the teach-me guide an agent reads to learn how to work in
// a Plan Desk + Factory repo. Deliberately self-contained: it references ONLY
// things Plan Desk ships (the MCP tools, the .agents/factory/ policy, the CLI).
// It never assumes a personal delegation skill, worker CLI, or ~/.agents setup
// exists on this machine — those are the operator's environment, not the repo's.

export const ONBOARD_GUIDE = `# Plan Desk — onboarding for agents

You are a coding agent working in a repo connected to Plan Desk. This is how the
system works and how you are expected to operate. Read it once at the start of a
session; run \`plandesk help\` for the command crash course.

## 1. What Plan Desk is

A local-first planning workspace. The board is a SQLite file on this machine
(default: \`~/.plandesk/workspace.db\` — one global board shared by every connected
repo). It is **not** committed to git. Travel and backup are explicit:
\`plandesk push --to <org>\` (hosted) or \`plandesk export --project <id> --out <path>\`
to a location you choose **outside** the repo. Opt into a repo-local db with
\`plandesk init --local-db\` if you need the plan physically in the project tree
(still gitignored by default):

- **Goals** — durable objectives; every task belongs to one. \`get_next_task\`
  walks the active goal's frontier.
- **Tasks** — units of work on a board (\`scope\` → \`todo\` → \`in_progress\` →
  \`done\`) and a dependency canvas (edges: blocks / depends_on / feeds / …).
- **Documents** — specs/RFCs attached to tasks. **Notes** — free-form working
  memory. **Artifacts** — deliverables you produce (\`create_artifact\`).
- **Comments** — humans leave feedback on docs/tasks/artifacts; you read and
  resolve it (\`list_comments\` / \`resolve_comment\`).
- **MCP** — you drive all of this over the Plan Desk MCP tools in a session where
  \`.mcp.json\` is loaded. The board is the source of truth, not your memory.

## 2. How you operate — the Factory workflow

This repo runs the Factory workflow (\`.agents/factory/\`). Your default posture:

1. **Orient.** Read \`.agents/factory/workflow.md\` + \`factory.md\`. Reconcile the
   board against reality (recent commits, working tree) before starting.
2. **Pull one work item.** \`get_next_task\` — never guess what's next. Read its
   linked document before touching anything.
3. **Red gate.** Run the task's verifier/gate first. Green-at-start proves
   nothing — get a discriminating failing check, or send the task back to
   \`scope\` with a comment.
4. **Act.** Do the work, then verify: re-run the claimed checks (exit codes are
   authoritative), read the actual diff — not a summary.
5. **Report.** Flip the task to \`done\` atomically with the verification, commit
   that item as one atomic commit whose subject names the task.

Then pull the next item. Drive the frontier to zero; don't pause for permission
between items (autonomous-stand mode).

## 3. Delegation — when a worker exists, and when it doesn't

The supervisor orchestrates; IC workers execute. **Delegate implementation to a
probed worker when one is available** (probe the dispatchers in
\`.agents/factory/workers/\` per \`.agents/factory/protocol.md\`).

**But do not assume any worker CLI or delegation skill is installed on this
machine** — those belong to whoever set the machine up, not to this repo. If no
worker probes successfully, **do the work yourself under the exact same
contract** (red gate → act → prove → diff-read → atomic commit). Never skip the
cycle just because you are the one typing. Write inline without dispatch for
trivial edits, integration, and review fixes under ~5 lines.

## 4. The MCP tools you'll use most

- Plan: \`scaffold_project_from_plan\` (stand up a whole plan at once),
  \`create_task\` / \`update_task\`, \`create_edge\`, \`create_document\` /
  \`update_document\`, \`create_note\`.
- Loop: \`get_next_task\` → work → \`update_task\` (\`in_progress\` then \`done\`) →
  \`record_agent_progress\`. Bracket multi-step work with \`start_agent_run\` /
  \`complete_agent_run\`.
- Feedback: \`list_comments\` → address → \`resolve_comment\`. Files you wrote can
  be annotated too — \`list_artifact_comments\`.
- Produce & share: \`attach_file\` (upload an image, embed the returned URL —
  don't inline base64), \`create_artifact\` / \`get_artifact\` / \`update_artifact\`
  (stored deliverables), \`create_share_link\` (a public Markdown URL a delegated
  worker can \`curl\` for full task/RFC context without MCP).

## 5. Rules that keep the board true

- **Atomic status.** Flip a task in the same step as the work event —
  \`in_progress\` the moment you start, \`done\` the moment it's verified, back to
  \`todo\`/\`scope\` if you stop. The board must always show what's happening now.
- **Reconcile.** At session start and before reporting finished, sweep the board
  against reality and fix any drift.
- **Never** guess/hardcode IDs, batch status updates for the end, reference line
  numbers in tasks/docs, create a non-trivial task without a Problem / Action
  Items / References description, or delete tasks/docs/notes (there is no delete
  by design — resolve, supersede, or set status).

## 6. Read more

- \`.plandesk/skill.md\` — the exact conventions (also included in CLAUDE.md).
- \`.agents/factory/factory.md\` + \`workflow.md\` — the per-item contract + session
  program. \`protocol.md\` + \`workers/\` — how dispatch actually works here.
- https://plandesk.asyncdot.com — full docs and guides.
`;

export function printOnboard(write: (s: string) => void = (s) => process.stdout.write(s)): void {
  write(`${ONBOARD_GUIDE}\n`);
}
