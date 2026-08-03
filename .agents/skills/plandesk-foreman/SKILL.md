---
name: plandesk-foreman
description: "Runs the Plan Desk board floor — takes one task or a whole frontier of todos, grooms each into a build contract, cuts slices, dispatches implementation to worker CLIs, verifies their claims, commits each verified slice, and stops at the risk lane. Use whenever asked to work a task, ship a ticket, take the next task, clear the todos, run the board, or hand implementation to a worker — even when the factory is not named."
user-invocable: true
argument-hint: "<task id | 'next' | 'all todo' | goal name> [--to <worker>]"
---

# Foreman

Takes board work to committed. Planning fills the board, the foreman runs the floor,
workers build, a human decides what merges.

The policy this runs on lives beside it and is not repeated here — the cycle
contract in [factory.md](../../factory/factory.md), dispatch and verification in
[protocol.md](../../factory/protocol.md), worker selection in
[routing.md](../../factory/routing.md), gates in
[lanes.md](../../factory/lanes.md), slice shapes in
[slicing.md](../../factory/slicing.md), the brief's additions in
[brief.md](../../factory/brief.md), the worker's standard in
[workmanship.md](../../factory/workmanship.md). Read the ones a run touches.

## Workflow

1. **Preflight.** Confirm the tree is clean, no dispatch is already running
   (`pgrep -f`), the board answers, and at least one worker in
   [workers/](../../factory/workers/) passes its probe. Each of these turns a
   long run into wasted tokens if it fails halfway, so check before starting,
   not on the way past. Open the run with `start_agent_run`.

2. **Resolve the scope.** A named task label (looked up with `list_tasks` /
   `get_task`) works one item. `next` calls
   `get_next_task`. `all todo` or a goal name takes the whole frontier — only
   `todo` tasks whose prerequisites are `done`; `scope` and `backlog` are
   waiting on a human and are not yours to release. Read each task's linked
   spec before judging it.

3. **Groom inline — do not dispatch this.** Judge each task against the
   Definition of Ready in [groom-task](../plandesk-groom-task/SKILL.md) and rewrite
   anything short of it with `update_task` yourself, following that skill's
   procedure — it is the one readiness bar this project keeps, so do not invent
   a second one here. Grooming is judgment about intent, and shipping that
   judgment to a worker is how a plan drifts from what was actually wanted. If a
   task cannot be groomed without a decision you do not own, return it to
   `scope` with a comment naming the decision, and carry on with the rest.

4. **Cut slices when the frontier is wider than one item.** One task needs no
   slicing. Several become deliverable units per
   [slicing.md](../../factory/slicing.md) — complete paths through the layers
   they touch, sized to one worker's context, grouped so parallel workers do not
   edit the same lines. The grouping goes in each brief's WBS snapshot, not in a
   file of its own — the task descriptions already hold the build contract, so
   do not restate the work anywhere.

5. **Dispatch implementation — default async.** One dispatch per tree, per
   [protocol.md](../../factory/protocol.md). Pick the worker from
   [routing.md](../../factory/routing.md) unless one was named; a named worker
   wins, and several named workers split the slices across worktrees. Build the
   brief to protocol.md's five-section contract — the bar, the result contract,
   the ground, the WBS snapshot, and a live `Context:` link.

   **Fire async unless the slice is trivial.** Background is the default for
   every real dispatch. Run foreground only when the slice is genuinely
   small (one obvious edit, expected under a few minutes) and the user asked
   for inline work. The recipe:

   1. Run the worker's `probe`; substitute `{prompt_file}` and `{repo_path}` in
      its `command` template — flags come from [workers/](../../factory/workers/),
      never from memory.
   2. Append the log redirect the engine owns:
      `> runs/worker-<task>.log 2>&1` (never put redirects in worker files).
   3. **Background through the harness** — `run_in_background: true` on the
      Shell/Bash tool. Never append `&` or wrap in `nohup … &`; that
      orphan-detaches, the harness fires a false "completed", and the real leaf
      keeps writing to a tree nobody is watching.
   4. **Arm the monitor in the same step**, also backgrounded — the watch loop
      in protocol.md's *Watching a live dispatch*. Do not dispatch and "remember
      to watch later."
   5. **Do not poll the harness completion notification.** Wrapper exit is
      unreliable (orphan shell, transient API blip). The monitor watches
      `runs/result-<task>.json`; use `Await` on the monitor shell when you are
      ready to verify, or continue other foreman work while it runs.

   **Stdin is per worker** — getting this wrong backgrounds a hang:

   | delivery | workers | rule |
   | --- | --- | --- |
   | prompt via stdin | claude, cursor, opencode | `< {prompt_file}` — **no** `< /dev/null` |
   | prompt via `@file` or arg | pi, codex, grok | pi: `@{prompt_file}`; codex: `"$(cat …)"`; grok: `--prompt-file` — add `< /dev/null` |

   Mint the live link explicitly: `create_share_link` on the task (or the goal,
   for a multi-slice run), `expires: 7d`, and put the returned `markdown_url`
   in the brief as `Context:`. The worker has no MCP access, so this is the
   only way it reads live board state instead of a copy that goes stale the
   moment someone edits the task. Derive the WBS snapshot from `list_tasks` +
   `list_edges` so the worker sees the agreed order and the paths a later item
   owns; a worker given one node and no map finishes the next one too.

   **Never dispatch a `kind: 'decision'` task.** Its resolution is a
   conversation with whoever owns the outcome; a worker given one will answer
   its own question and record a fabrication as a decision. Report it by task
   **label** as awaiting a human and take the next frontier item — a decision
   task blocks only itself; unlike a lane gate it does not stop the run.

6. **Stage the moment a worker returns, before reading anything.** Review takes
   minutes and unstaged work is defenceless for all of them; staged work
   survives a later `git checkout` because git restores it from the index. This
   ordering is the cheapest real protection in the whole run.

   **Unless the dispatch was killed.** No result file means it ran no gates and
   wrote no result, so the tree holds unverified partial output rather than work
   product. Discard it and re-dispatch clean per
   [protocol.md](../../factory/protocol.md) — staging it makes salvage look like
   a deliverable, and the next reader cannot tell the difference.

7. **Verify the claims.** Follow the verification sequence in
   [protocol.md](../../factory/protocol.md) — gate integrity before re-running
   anything, then suppressions, then per-package test counts against the
   pre-dispatch baseline, then debris. Exit codes decide, not the worker's
   summary. A dispatch that fails verification is recorded and re-scoped, not
   retried blindly with the same brief.

8. **Commit each verified slice on its own.** One work item, one commit, the
   subject naming the task. Do this as soon as the slice verifies — batching
   commits until the end of a run means a single later failure puts every
   earlier success at risk, and it breaks the 1:1 between history and board.

9. **Review what landed.** Read the diff — the hunks, not the worker's
   transcript. For anything beyond an isolated change, dispatch a fresh reviewer
   that did not write the code, ideally a different model family, and give it
   the acceptance criteria and the diff. A reviewer inheriting the author's
   context confirms the author's assumptions.

10. **Apply the lane.** [lanes.md](../../factory/lanes.md) decides what happens
    next: `auto` continues, `approve` posts a diff summary and waits for a human
    to resolve it, `full` waits for independent review and a human. Flip the
    task to `done` only when its gate has cleared, in the same step as the
    verification. Call `record_agent_progress` and append the cycle to
    `runs/metrics.jsonl`.

11. **Take the next slice, or stop.** Repeat from step 5 while the frontier has
    work and no gate is blocking. On long runs, pulse per
    [heartbeat.md](../../factory/heartbeat.md) — a worker with no output, no
    file changes, and flat CPU is stalled rather than thinking, and the tree may
    already hold most of its work. Close with `complete_agent_run` and report at
    diff level — naming tasks by label, not bare id (see `.plandesk/skill.md`):
    what shipped, what is waiting on a human, what failed and why.

## Stopping

Stop the run and report — do not work around it — when:

- a **lane gate** needs a human,
- a worker returns **`blocked`** with a question you cannot answer from the board,
- a gate cannot be satisfied honestly, or
- the frontier empties.

**Skip dispatch, but continue the run**, when a frontier item is `kind: 'decision'`.
Unlike a lane gate — which blocks the tree because uncommitted work occupies it —
a decision task blocks only itself. Report it by **label** as awaiting a human
and take the next frontier item.

Never merge, and never release `scope` → `todo`; both belong to whoever owns the outcome.

Leave the board true on the way out. A status that does not match what actually
happened is worse than no status, because the next run trusts it.

## Boundaries

- Groom inline, dispatch implementation. Reversing this is the common failure.
- **Never dispatch a `kind: 'decision'` task.** Its resolution is a conversation
  with whoever owns the outcome; a worker given one will answer its own question
  and record a fabrication as a decision. Report it as awaiting a human and take
  the next frontier item.
- Do not restate the readiness bar; it lives in
  [groom-task](../plandesk-groom-task/SKILL.md) and a second copy would drift from it.
- Do not restate the task's spec in a brief — link it live.
- Do not run two dispatches in one tree; give concurrent slices their own
  worktrees.
- Do not batch commits, and do not commit work whose gate has not cleared.
- If a change balloons past its triaged size, return it to `scope` with the
  reason rather than absorbing it.
