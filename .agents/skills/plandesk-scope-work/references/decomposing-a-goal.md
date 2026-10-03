# Decomposing a Goal

A Goal is the durable contract a human hands over (`objective` +
`verification_surface` + constraints). The human authors it; **the system owns
cycle-sizing.** Output is cycle-sized tasks under that Goal, edge-sequenced,
that together make the `verification_surface` pass.

A task is cycle-sized when **one worker can take it start → proven-done in one
coherent pass** — one red gate made green, verified, every changed line tracing
to that task. If you cannot state a single checkable "done", or it would need
more than one verify-and-integrate pass, split it. Prefer more small cycles over
fewer large ones; the loop only stays unstuck when each step is genuinely one
pass.

Place these with `create_task` + `goal_id` and `create_edge` — not
`scaffold_project_from_plan`, which stands up a new project on the default goal.

**Refusal is not terminal.** A worker that finds a task too big to finish to the
bar splits it into cycle-sized children under the same Goal, back in `scope`,
and records why in a comment. A too-big task is a sizing miss to correct, never
a dead end.
