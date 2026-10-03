# Bugs: the root cause belongs in the task

The Problem row's "a symptom with no located cause" is the rule for bugs, so
state it plainly. A bug is ready when its Problem carries **either**:

- **the located cause** — the file and function, and why it misbehaves; or
- **a repro plus a boundary** — the steps that reproduce it and what has already
  been ruled out.

**Never a guess dressed as a cause.** A guessed cause is worse than an absent
one: the worker inherits it as evidence and scopes the fix to it, so the real
defect survives and now has a test pinned to the wrong explanation.

Observed: *"clicking a task under a document's links does nothing."* Groomed
from the symptom, that becomes "fix the link" — and the fix would have pointed
at nothing, because the real cause was that the board's task drawer lived in
component state and no task was addressable by URL at all. The cause changed
what got built, not just where.

**An investigation is a legitimate task**, not an ungroomed one. When the cause
is unknown, the deliverable *is* the cause: the Validation contract is a
reproduction and a written finding, not a fix. Split the fix into its own task
once the cause is known — that second task is the one that carries it.
