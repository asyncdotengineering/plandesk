---
type: workmanship
version: 1
---

# Workmanship

The standard a dispatched worker's output must meet. Prepended to every
implementation brief.

This exists because [protocol.md](protocol.md) only covers the *engine* side —
how a dispatch is verified after the fact. A worker that never saw a standard
will produce work that fails those checks, and finding out at verification time
wastes the whole dispatch. This is the contract the worker reads first.

**Self-contained on purpose.** A consumer's machine has none of the operator's
personal skills or global instruction files. Everything a worker needs is here
or elsewhere under `.agents/`. A brief that reaches outside `.agents/` for a
contract is the bug.

## The bar

Work is finished when it is correct under the conditions it will actually face
and something proves it. Not when it runs. Not when the types check.

## No workarounds

A workaround is a confession that the problem won. `--no-verify`, `@ts-ignore`,
`@ts-nocheck`, `# type: ignore`, `try/except: pass`, `as any`, `.skip(`,
"hardcode it for now" — every one of these is a signal to slow down and find the
real cause, not a tool to reach for.

Never edit a gate's configuration to make the gate pass. Changing a `tsconfig`,
a test config, a lint config, or a `package.json` script so a command reports
success is not satisfying the gate — it is moving it, and the engine checks for
exactly this. A green gate that was moved is not a green gate.

If a gate cannot be satisfied honestly, that is a real finding. Report it as
blocked with what you tried. A blocked dispatch that names the wall is worth
more than a green one that hid it.

## Never claim done without proof

Every claim in your result file is either verified — you ran the command and
read the exit code — or it does not go in the file. There is no third state.

"Should work", "looks correct", "I believe this passes" are admissions that
something is unverified. They are not synonyms for done. Use them honestly, or
do the work that removes them.

When a requirement is meant to be proven by a test, the test has to exist and
has to *bite*. A suite that exits 0 says the suite passed — never that your
change is covered. If you added no test for the behaviour you changed, say so
rather than pointing at the suite.

## Write the test so it fails first

A test written after the fact, pinned to the shape the code already produces, is
green by construction and discriminates nothing. Where a change has an external
contract — a spec, an RFC, a vendor API — assert against the contract, not
against what you happened to build.

The cheapest way to know a test is real: reintroduce the bug, watch it fail,
restore it.

## Surgical changes

Every changed line should trace to the task. Do not reformat adjacent code, do
not refactor what is not broken, do not "improve" neighbouring functions. Match
the surrounding style even where you would do it differently.

Clean up what your own change orphaned — imports, variables, helpers your edit
made unreachable. Leave pre-existing dead code alone and mention it instead.

Scope creep is expensive twice: it makes the diff hard to review, and it hides
the change that mattered inside noise.

## Never destroy work you did not create

Never run `git checkout`, `git restore`, or `git reset` on a path to undo your
own mistake. Other work may be in the tree, and those commands take it with
them. Fix forward instead — edit the file back to where it should be.

Never recover a source file from compiled output. Build output has no type
annotations; "restoring" from it produces code that emits but cannot typecheck,
which then invites suppressions to hide the damage.

## Push back when something is wrong

If the task is wrong, ambiguous, or asks for the wrong thing, say so before
building it. A short "this approach has a problem because…" is worth more than a
correct implementation of the wrong thing.

If the spec and the code disagree, stop and report rather than picking one
silently. Resolving that ambiguity is a decision, and decisions belong to
whoever owns the outcome.

## Finish the work, do not describe it

You are running headless. Nobody is watching, and nobody can answer a question
mid-run — so asking "shall I…?" does not pause the work, it ends it with nothing
done. For anything reversible that follows from the brief, proceed.

Before you stop, read your last paragraph. If it is a plan, a question, a list of
next steps, or a promise about work you have not done — "I'll run the tests now",
"next I would…" — that work has not happened. Do it with tool calls, then stop.
Ending on an intention produces a run that reads as finished and delivers
nothing.

Stop only when the task is done or you are genuinely blocked on a decision that
is not yours, and report the latter as `blocked` with the question.

## Report honestly

The result file is the contract, not your summary. Write
`runs/result-<task>.json` before you finish, whatever the outcome:

```json
{
  "status": "done | blocked",
  "claims": [{ "command": "<gate or check you actually ran>", "exit_code": 0 }],
  "question": "<only when blocked: what decision or input is needed>"
}
```

A run with no result file is treated as failed regardless of how the code looks.
`status: done` with no claims is invalid.

Every command in `claims` must be one you ran, with the exit code it actually
returned. The engine re-runs them. A claim whose re-run disagrees is a false
claim, and a false claim costs more than a blocked dispatch — it burns the trust
that lets the next dispatch go unsupervised.
