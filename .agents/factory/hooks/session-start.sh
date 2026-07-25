#!/usr/bin/env bash
# SessionStart hook — re-anchors the agent to the bound Plan Desk project's
# board state (current task, its linked doc, last recorded progress, or the
# next actionable task when idle) at the moments the thread is most likely to
# be lost: fresh startup, resume, and post-compaction.
#
# Best-effort only. A broken or slow binding must never block a session from
# starting, so every failure path below falls through to a silent, successful
# exit.
set +e

# Drain (but don't require) Claude Code's SessionStart JSON envelope on
# stdin — {"hook_event_name":"SessionStart","source":"startup|resume|compact",...}.
# Behavior here is the same for every matched source, so the payload itself
# is unused beyond being consumed.
cat >/dev/null 2>&1

context_json="$(plandesk context --json 2>/dev/null)"
if [ -z "$context_json" ]; then
  exit 0
fi

node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let context;
  try {
    context = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const lines = [];
  if (context.current_task) {
    const task = context.current_task;
    lines.push(`Plan Desk — current task: ${task.label} (${task.status}, id ${task.id})`);
    if (context.linked_doc) {
      const doc = context.linked_doc;
      lines.push(`Linked doc: ${doc.title}${doc.status_line ? ` — ${doc.status_line}` : ""}`);
      if (doc.body) {
        lines.push("");
        lines.push(doc.body);
      }
    }
    if (context.last_progress) {
      lines.push("");
      lines.push(`Last progress: ${context.last_progress.message} (${context.last_progress.created_at})`);
    }
  } else if (context.next_task) {
    lines.push(`Plan Desk — no task in progress. Next actionable task: ${context.next_task.label} (id ${context.next_task.id})`);
  } else {
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\n"),
    },
  };
  process.stdout.write(JSON.stringify(output));
});
' <<< "$context_json"

exit 0
