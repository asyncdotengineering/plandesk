---
type: protocol
version: 1
---

# Dispatch protocol

The deterministic contract between the supervising agent (the engine) and any
worker CLI. There is no SDK binding: the only contract is files in, one JSON
shape out — any CLI agent that can follow instructions satisfies it.

## Dispatch (engine side)

1. Pick a worker file from [workers/](workers/) whose `probe` exits 0 on this
   machine. Never assume a worker exists; never invoke flags from memory —
   only the file's `command` template, with `{prompt_file}` substituted.
2. Write the brief to `runs/brief-<task>.md`: the task, its spec, the gate
   command(s) to satisfy, and the result contract below.
3. Run the command. One process per dispatch, headless, from the repo root.

## Result (worker side)

The brief instructs the worker to end by writing `runs/result-<task>.json`:

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check run>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
```

## Verification (engine side — deterministic, no model judgment)

- `status: done` with no `claims` is invalid — treat as failed.
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
  git diff HEAD | grep -nE '^\+.*(@ts-nocheck|@ts-ignore|@ts-expect-error|eslint-disable|as any|as unknown as|\.skip\(|\.todo\(|xit\()'
  ```

  `@ts-nocheck` is the dangerous one — one line silences a whole file.
- Re-run each claimed command; a claim whose re-run exit code differs from the
  claimed one is a false claim — treat the dispatch as failed, record it, and
  do not retry the same approach blindly.
- **Check for debris.** `git checkout` does not remove untracked files. Run
  `git status --short --untracked=all` — invented files and codemod scripts
  survive a revert and break the next build.
- Only after claims verify does the engine read the diff and apply the lane
  gate from [lanes.md](lanes.md).

Exit codes are authoritative — but only when the gate they came from is intact.
Model output is metadata.

## Protecting work in flight

- **Commit every verified work item immediately** ([factory.md](factory.md):
  one work item, one commit). Verified-but-uncommitted work is unprotected:
  a later dispatch's `git checkout` can erase it, and there is no recovering it.
  Never defer a commit to batch it with a later gate.
- **Never recover source from `dist/`.** Compiled output has no type
  annotations; "restoring" TypeScript from it produces code that emits but
  cannot typecheck, which then invites suppressions to hide the damage. If
  sources are lost, revert to the last commit and redo.
- **One dispatch at a time per repo.** Two workers on one tree corrupt it.
  Confirm the previous process is dead (`pgrep -f`) before dispatching again —
  a worker CLI can report exit while a child keeps mutating files.

## Stall detection

A worker is stalled, not thinking, when **all** of these hold:

- no new stdout line for ~10 min, **and**
- no file modified in the repo for ~10 min (`find . -newermt '-10 minutes'`), **and**
- CPU time flat across a 25s sample (`ps -o time= -p <pid>`).

Kill it. Then **assess the tree before re-dispatching** — a stalled worker may
have completed most of the work. Re-running a 25-minute conversion to redo what
is already correct on disk is waste; scope a follow-up dispatch to the remainder.
