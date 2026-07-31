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
| 14 | If your change accepts a caller-supplied value the server then trusts, say what stops org A supplying org B's value — and test it | an input the task did not specify arrives with no threat model attached |

Cheapest way to know a test is real (rule 6): reintroduce the bug, watch it fail,
restore it.

## A guard is unverified until you have watched it fail (rule 6)

Rule 6 says write the test so it fails first. This is the same rule for the
guards that are not tests — type assertions, coverage checks, manifests,
golden fixtures. They are the easiest thing in a codebase to get wrong, because
a broken one is indistinguishable from a working one: both are silent, and both
leave the suite green.

One file in this repo produced **five** guards that looked sound and could not
fail:

1. a coverage guard comparing its own constants to its own constants
2. `{} as AssertEveryEntryHasImport` — a cast, so the mapped type was never checked
3. `true as _GoalGuard` — **an assertion to a conditional type always compiles**,
   because `never` is assignable to everything, so the assertion succeeds in
   exactly the case it exists to catch
4. a coverage snapshot projecting only the collections it already knew about, so
   a newly added one was absent from *both* sides and compared equal
5. a canonical-ordering test that returned before asserting, because the fixture
   happened to contain one row

Every one passed review-by-reading. Every one failed the first sabotage.

**So: for any guard you add or touch, break the thing it guards, watch it fail,
and restore.** State the observed failure — the file and line — in your notes.
"The guard is in place" is not a claim; "I removed X, the guard failed at Y:N,
I restored it" is.

Two specifics worth memorising:

- **Annotation, never assertion.** `const x: Guard = true` fails when `Guard` is
  `never`. `const x = true as Guard` does not.
- **A check that compares the system to a hand-maintained description of itself
  cannot notice what the description omits.** Derive from the production
  structure, or the guard only covers what someone remembered.

Related: a build that fails after your sabotage is not proof the *guard* fired.
Confirm the error names the guard, not collateral damage elsewhere.

## Caller-supplied inputs are authorization surfaces (rule 14)

A header, query parameter, body field, or any id you look something up by is an
authorization surface, whether or not the task called it one. This applies hardest
to inputs the task **did not** specify: when a spec asserts a value is "available"
without saying how it arrives, whoever builds it invents a transport, and an
invented transport has no threat model attached because nobody wrote down what the
value is allowed to be.

Two rules:

- **A cross-tenant value behaves exactly like an unknown one — rejected.** Never
  silently downgrade it to a weaker-but-valid actor, default, or scope. That
  launders an untrusted input into a trusted one: the same defect wearing a
  different hat.
- **Check the direction of every failure branch.** Unknown, malformed and
  wrong-state values usually fail closed, because someone thought about them. The
  cross-tenant branch is the one nobody thought about, so it is the one that fails
  open. If every branch but one fails closed, examine that one.

This repo has closed five separate rounds of workspace-isolation leaks. Every one
passed a full green suite first, because **a suite with a single tenant has
nothing to leak to.** Tests exercising one org prove nothing about isolation.

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
