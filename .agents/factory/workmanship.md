---
type: workmanship
version: 1
---

# Workmanship

The bar a dispatched worker's output must meet. Prepended to every implementation
brief. Self-contained on purpose: a consumer's machine has none of the operator's
global instruction files, so everything a worker needs lives under `.agents/`. A
brief that reaches outside `.agents/` for a contract is the bug.

**Done means correct under the conditions it will actually face, with something
that proves it.** Not that it runs. Not that the types check.

## Hard rules

| # | Rule | Why |
| --- | --- | --- |
| 1 | No `--no-verify`, `@ts-ignore`, `@ts-nocheck`, `# type: ignore`, `try/except: pass`, `as any`, `.skip(`, "hardcode it for now" | each marks a cause to find, not a tool to reach for |
| 2 | Never edit a gate's config (`tsconfig`, test or lint config, `package.json` scripts) to make it pass | that moves the gate rather than satisfying it, and the engine checks for exactly this |
| 3 | A command goes in `claims` only if you ran it and read the exit code | there is no state between verified and absent |
| 4 | Never write "should work", "looks correct", "I believe this passes" | they are admissions of unverified state, not synonyms for done |
| 5 | If you added no test for the behaviour you changed, say so | a suite exiting 0 says the suite passed, never that your change is covered |
| 6 | Write the test so it fails first; assert against the contract (spec, RFC, vendor API), not the shape you built | a test pinned to your own output is green by construction and discriminates nothing |
| 7 | Every changed line traces to the task — no reformatting, no drive-by refactors, match surrounding style | scope creep hides the change that mattered inside noise |
| 8 | Clean up what your change orphaned; leave pre-existing dead code alone and mention it | |
| 9 | Never `git checkout` / `git restore` / `git reset` a path to undo your own mistake — fix forward | those commands take other uncommitted work in the tree with them |
| 10 | Never recover a source file from compiled output | it emits but cannot typecheck, which then invites suppressions to hide the damage |
| 11 | If the task is wrong or ambiguous, say so before building it | resolving that is a decision, and decisions belong to whoever owns the outcome |
| 12 | If the spec and the code disagree, stop and report — never pick one silently | |
| 13 | Never end on an intention: "I'll run the tests now", "next I would…" | you are headless, so a question ends the run with nothing done rather than pausing it |

Cheapest way to know a test is real (rule 6): reintroduce the bug, watch it fail,
restore it.

If a gate cannot be satisfied honestly, report `blocked` with what you tried — a
blocked dispatch that names the wall beats a green one that hid it.

## The result contract

Write `runs/result-<task>.json` before you finish, whatever the outcome:

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check you actually ran>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
```

- No result file → failed, regardless of how the code looks.
- `status: done` with no claims → invalid.
- The engine re-runs every claim. One that disagrees on re-run burns the trust that
  lets the next dispatch go unsupervised.
