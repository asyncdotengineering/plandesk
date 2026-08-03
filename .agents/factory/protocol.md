---
type: protocol
version: 1
---

# Dispatch protocol

The deterministic contract between the supervising agent (the engine) and any
worker CLI. There is no SDK binding: the only contract is files in, one JSON
shape out — any CLI agent that can follow instructions satisfies it.

## The result contract — put this in every brief, verbatim

Everything below is engine-side detail. This is the part the worker must not
miss, so it goes first here and near the top of the brief:

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check actually run>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
```

Written to `runs/result-<task>.json`, before the worker finishes, whatever the
outcome. Three ways it is invalid, all treated as a failed dispatch:

- **No file.** Absent means unfinished, regardless of what the process reported.
- **`status: done` with no claims.** A claim is the only evidence that exists.
- **A status outside `done | blocked`.** Observed: a result written as
  `status: "passed"` with zero claims — a dispatch that looked successful in
  the directory listing and proved nothing.

## Dispatch (engine side)

1. Pick a worker file from [workers/](workers/) whose `probe` exits 0 on this
   machine. Never assume a worker exists; never invoke flags from memory —
   only the file's `command` template, with `{prompt_file}` and `{repo_path}`
   substituted.
   Which worker suits which task is data: [routing.md](routing.md).
2. Write the brief to `runs/brief-<task>.md`. It carries five things:

   | section | content | live or frozen |
   | --- | --- | --- |
   | the bar | [workmanship.md](workmanship.md), pasted in full | frozen |
   | the result contract | the JSON above, verbatim | frozen |
   | the ground | absolute repo path, and the gate command(s) to satisfy | frozen |
   | the plan | the WBS snapshot below | **frozen, deliberately** |
   | the spec | `Context: <markdown_url>` from `create_share_link` | **live** |

   The last two pull in opposite directions on purpose. **The spec is linked,
   never pasted** — a human editing it mid-flight should reach the worker.
   **The WBS is pasted, never linked** — a board re-ordered mid-dispatch must
   not silently redirect a worker that is already building.
3. Run the command. One process per dispatch, headless.

### The WBS snapshot

A worker is handed one task and can call no MCP tool, so without this it infers
the plan from a single node. Derive it from `list_tasks` + `list_edges` at
dispatch time and paste it in:

```markdown
## Where this sits

| # | task | lane | depends on | status |
| --- | --- | --- | --- | --- |
| 1 | t-4b2 Add the schema column | auto | — | done |
| 2 | **t-9c1 Backfill existing rows ← YOU ARE HERE** | approve | t-4b2 | in_progress |
| 3 | t-7d8 Read the column in the API | full | t-9c1 | todo |

Owned by later items — do not touch: `src/api/routes/*.ts`
```

That last line is the one that changes behaviour. A worker given one task and no
map will helpfully finish the next one too, and the following dispatch then opens
on a tree it did not write and cannot account for. Naming the paths a later item
owns costs one line and prevents that.

### Dispatch mechanics

These four are not optional detail — a dispatch missing any of them is the
common cause of a run that produces code but no verifiable result.

- **Redirect all output.** Append `> runs/worker-<task>.log 2>&1` to every
  command. A worker's stdout is evidence: it is where a refusal, a missing
  credential, or an "unknown model id" appears. Without the redirect that
  evidence is lost and a failed dispatch looks identical to a silent one.

  **The redirect is the engine's job, not the worker file's.** A `command:`
  template carries the invocation and its flags; it cannot carry the redirect
  because the log filename is per-task and the file has no way to know it. So
  the contract is: substitute the placeholders, append the redirect, then run.
  A worker file is authoritative about *flags*, never about *plumbing* — do not
  read "run `command` verbatim" as forbidding the redirect, and do not move the
  redirect into the worker files to satisfy the word.

- **Background through the harness, never with `&`.** Dispatch with the
  harness's own background mechanism (`run_in_background`). Appending `&` or
  wrapping in `nohup … &` orphan-detaches the process: the wrapper exits
  immediately, the harness fires a completion notification for a worker that has
  not started, and the real leaf keeps writing to a tree nobody is watching. The
  false "completed" is worse than no signal, because the engine acts on it.
- **Working directory is explicit.** State the absolute repo path in the brief,
  and pass the worker's own cwd flag when its CLI has one. "From the repo root"
  is not a location — it is an assumption that breaks the moment a dispatch runs
  anywhere but the tree you were standing in.
- **Guard stdin only when the prompt is an argument.** A worker whose `command`
  already redirects the brief in (`< {prompt_file}`) has its stdin consumed and
  needs nothing further. A worker given the prompt as an argument must add
  `< /dev/null`, or a CLI that reads stdin when idle will block forever with no
  output — `codex exec` announces "Reading additional input from stdin…" and
  hangs.
- **Completion is a file, not an exit code.** The harness signal fires when the
  wrapper process exits, which can happen while a child still writes, or after a
  transient API error. Treat `runs/result-<task>.json` as the completion signal:
  present and parseable means finished, absent means unfinished regardless of
  what the process reported. Say this in the brief in those words — the runs
  that omit the result file are the ones whose brief left it implicit.
- **Never put a timeout on the dispatch itself.** Background the worker and let
  it run; bound it with the stall check in [heartbeat.md](heartbeat.md), which
  measures whether work is *happening*, not how long it has taken. A wall-clock
  limit on the command cannot distinguish a worker that is thinking from one
  that is stuck, so it kills good work at an arbitrary boundary — and a real
  build is exactly the kind that runs long. If the harness clamps the value you
  pass, the effective limit is not even the one you chose.

### Watching a live dispatch

Backgrounding without watching is how a dead worker passes for a busy one.
**Silence reads as "still running"**, so arm a monitor at dispatch time — in the
same step as the dispatch, also backgrounded — not as a thing to remember
afterwards.

**Do not poll the harness worker notification.** It fires on wrapper exit and
is unreliable: an orphan `&` shell, a transient API blip, or a parent that exits
while the leaf still runs all produce false "completed" signals. Watch the
result file instead; use `Await` on the monitor shell (Cursor) or continue other
supervisor work until the monitor emits a terminal line.

The monitor watches `runs/result-<task>.json`, because that is the completion
signal. It must emit a line for **every** terminal state, not just success:

```bash
# Resolve the leaf first — sample the wrapper's CPU and you will read "flat"
# forever while the child works: ps -eo pid,ppid,time,command | grep <wrapper>
LEAF_PID=<leaf-pid>

while true; do
  if [ -f runs/result-<task>.json ]; then
    st=$(jq -r '.status // empty' runs/result-<task>.json 2>/dev/null)
    if [ "$st" = "blocked" ]; then echo "BLOCKED <task>"; else echo "DONE <task> status=${st:-unknown}"; fi
    break
  fi
  if ! kill -0 "$LEAF_PID" 2>/dev/null; then
    sz=$(wc -c < runs/worker-<task>.log 2>/dev/null || echo 0)
    echo "EXIT <task> without result — log ${sz}B"; break
  fi
  sleep 60
done
```

Three rules that make it useful rather than decorative:

- **Cover the crash branch.** A monitor that greps only for the success marker
  is silent through a crash, a hang, and a usage-limit exit — and that silence
  is indistinguishable from progress. If the worker died right now, the monitor
  must say so.
- **A result file that appears is not automatically a pass.** Read its `status`;
  `blocked` is a terminal state that needs the engine, not a failure to ignore.
- **Watch the leaf, not the wrapper** — same reason as stall detection below.

**Stdin delivery by worker** (wrong choice = backgrounded hang):

| delivery | workers | rule |
| --- | --- | --- |
| stdin is the prompt | claude, cursor, opencode | `< {prompt_file}` only — never `< /dev/null` |
| `@file`, arg, or `--prompt-file` | pi, codex, grok | add `< /dev/null` after the command |

For a run of several dispatches, add a periodic checkpoint line (results seen,
files changed per tree) so a long run surfaces on a cadence instead of going
dark until the end — or stack [plandesk-timebox](../skills/plandesk-timebox/SKILL.md).

### When a dispatch is killed

A dispatch ends in one of three states, and they are not interchangeable:

| state | signal | what to do |
| --- | --- | --- |
| **done** | result file present and parseable | verify its claims |
| **blocked** | result file present, `status: "blocked"` | read the wall it named; re-scope |
| **killed** | **no result file**, process gone | see below |

A killed dispatch ran no gates and wrote no result. Whatever is in the tree is
**unverified partial output, not work product** — it may not compile, and it may
be half of a design its author had not finished choosing.

**Discard it and re-dispatch clean.** Do not continue from it, and do not ask
the next worker to "finish" it. Continuing from salvage is how one task consumed
eight cycles: each round inherited the previous round's half-made decisions,
and nobody ever chose the design deliberately. Reverting costs one dispatch;
building on a foundation nobody chose costs several, and the cost is invisible
until late.

Before discarding, confirm the tree holds nothing else — a killed dispatch's
output and your own uncommitted work look identical in `git status`. This is
the reason the previous slice is committed before the next one starts.

## Verification (engine side — deterministic, no model judgment)

- Reject an invalid result outright (see the result contract above) — no file,
  no claims, or an unknown status all mean failed, before anything is re-run.
- **Confirm the work exists before reading the claims.** A result file describes
  what a worker says it did; `git status` says what changed. Compare them first:

  ```
  git status --porcelain          # did anything change at all?
  stat -f '%Sm' -t '%H:%M:%S' <a file the result claims to have edited> \
                              runs/result-<task>.json
  ```

  A file whose mtime predates the result was not written by that dispatch.
  Real incident: a worker returned `status: "done"` with per-guard evidence
  citing specific line numbers and specific compiler errors, having modified no
  file. The claims were internally coherent and entirely invented, and the suite
  was green before and after — because the thing it claimed to fix was inert in
  both states. Nothing downstream of the result file can catch this; only the
  filesystem can.
- **Verify gate integrity BEFORE re-running any claim.** Re-running a command
  proves nothing if the command's configuration moved:

  ```
  git diff HEAD -- '*tsconfig*.json' '*vitest.config*' '*/package.json' \
                   '*.eslintrc*' 'turbo.json'
  ```

  Any change to a gate's config by a worker invalidates the dispatch. Real
  incident: a worker added `noCheck: true` + `exclude: ["src/**/*.test.ts"]` to
  `tsconfig.json`; `pnpm build` then honestly reported "0 errors" while checking
  nothing and hiding 334 real ones. A green gate that was moved is not a green gate.
- **Sweep for suppressions.** Anything the worker used to silence a gate rather
  than satisfy it fails the dispatch:

  ```
  git diff HEAD | grep -nE '^\+.*(@ts-nocheck|@ts-ignore|@ts-expect-error|eslint-disable|as any|as unknown as|\.skip\(|\.todo\(|\bxit\()'
  ```

  `@ts-nocheck` is the dangerous one — one line silences a whole file. Keep the
  word boundary on `\bxit\(`: unanchored, it matches the tail of `process.exit(`
  and fails an honest dispatch for adding a CLI exit code.
- Re-run each claimed command; a claim whose re-run exit code differs from the
  claimed one is a false claim — treat the dispatch as failed, record it, and
  do not retry the same approach blindly.
- **The gate is the repo-wide suite, never a list of packages you chose.**
  Require the root command that runs every package (`pnpm test` / `turbo run
  test` or this repo's equivalent), and require a per-package count for **all**
  of them in the result. A dispatch reporting four packages in a repo that has
  seven has not been verified; it has been sampled. Real incident: a run gated on
  four named packages for hours while a fifth stayed red, and the commit that
  broke it had been reported green — the break was in a package nobody was
  running. A missing package in the result is itself the evidence that the root
  command was not the one executed.
- **A green suite does not prove an assertion is covered.** A worker maps
  `satisfies_assertions` onto a claim by hand, so `pnpm test` exiting 0 says the
  suite passed — never that a test for REQ-N exists. Diff the per-package test
  counts against the pre-dispatch baseline: a requirement whose package gained
  **zero** tests is unproven, whatever the proof file asserts. (Observed: a
  dispatch claimed REQ-5 — an entire new CLI command — satisfied by `tests`,
  while that package's count sat unchanged at 208.)
- **Read what a new test asserts, not just that it passes.** A test pinned to
  the shape the worker happened to build is green by construction and
  discriminates nothing. For any behaviour with an external contract (an RFC, a
  vendor API), check the assertion against the spec, not against the diff. Then
  prove the test bites: reintroduce the bug, watch it fail, restore. (Observed:
  a `slow_down` test asserted `{status:'pending', interval:5}` — the exact
  literal the code returned — while RFC 8628 §3.5 requires the client to *add*
  5s to its own interval. Green, and backwards.)
- **Check for debris.** `git checkout` does not remove untracked files. Run
  `git status --short --untracked=all` — invented files and codemod scripts
  survive a revert and break the next build.
- Only after claims verify does the engine read the diff and apply the lane
  gate from [lanes.md](lanes.md).

Exit codes are authoritative — but only when the gate they came from is intact.
Model output is metadata.

## Protecting work in flight

- **Stage the moment a dispatch returns — before you review it.** `git add` the
  changed paths as step one, ahead of any verification. Review takes minutes,
  and unstaged work is defenceless for all of them. This is not bookkeeping; it
  is the cheapest real protection available:

  | State of your work | Survives `git checkout` | Survives `git reset --hard` |
  | --- | --- | --- |
  | unstaged | **no** | **no** |
  | staged | yes — restored from the index | **no** |
  | committed | yes | **no** — reachable only via reflog |
  | **pushed** | yes | **yes** — the remote is the only copy a worker cannot reach |

  **Push, do not merely commit.** A brief that forbids `git reset` does not
  prevent one; nothing enforces the instruction, and a worker that decides to
  tidy history will take your commits with it. Observed: a worker ran
  `git reset` back past two of the supervisor's commits — a release and a gate
  repair — then committed its own work on top. Both commits survived only
  because they had been pushed, and recovery was `git reset --hard origin/main`.
  Had they been local, the reflog would have been the only route back.

  A real incident hinged on exactly this: a worker undid its own broken codemod
  with `git checkout -- <testfiles>`, which also erased an earlier dispatch's
  unstaged work. Staged, it would have been restored from the index untouched.
  Staging also gives a clean review boundary — `git diff --staged` is the
  worker's output, and anything you fix afterwards shows up unstaged.
- **Commit every verified work item immediately** ([factory.md](factory.md):
  one work item, one commit). Staging survives `git checkout -- <path>`; only a
  commit survives `git checkout HEAD -- <path>`. Never defer a commit to batch
  it with a later gate.
- **Never recover source from `dist/`.** Compiled output has no type
  annotations; "restoring" TypeScript from it produces code that emits but
  cannot typecheck, which then invites suppressions to hide the damage. If
  sources are lost, revert to the last commit and redo.
- **One dispatch at a time per repo.** Two workers on one tree corrupt it.
  Confirm the previous process is dead (`pgrep -f`) before dispatching again —
  a worker CLI can report exit while a child keeps mutating files.
- **The engine is the second writer.** "One dispatch at a time" applies to you
  as well: editing files in the same tree while a dispatch is live puts your own
  unstaged work in the blast radius. A worker told to leave unrelated changes
  alone can still restore them to HEAD while tidying its scope, and unstaged
  edits do not survive that. Observed: five policy files edited during a live
  dispatch, all reverted, none recoverable from git because none were staged.
  Either stage every edit as you make it, or do not touch the tree until the
  dispatch returns.

## Stall detection

A worker is stalled, not thinking, when **all** of these hold:

- no new stdout line for ~10 min, **and**
- no file modified in the repo for ~10 min (`find . -newermt '-10 minutes'`), **and**
- CPU time flat across a 25s sample on the **leaf** process.

Two ways to read those signals wrong, both observed:

- **Measure the leaf, not the wrapper.** A worker launched through a shell
  (`bash -c "… > log 2>&1"`) leaves the parent parked at ~0.01s of CPU forever
  while the child does the work. Sampling the parent reports "flat" every time.
  Find the leaf first — `ps -eo pid,ppid,time,command | grep <parent>` — and
  sample that. A healthy worker was nearly killed on the wrapper's reading.
- **Silence is not a signal for every CLI.** Some workers flush their log in
  bulk rather than line by line, so an empty log means nothing on its own. Check
  the worker's own file before treating quiet as stalled.

Kill it only when the leaf agrees. Then **assess the tree before re-dispatching** — a stalled worker may
have completed most of the work. Re-running a 25-minute conversion to redo what
is already correct on disk is waste; scope a follow-up dispatch to the remainder.
