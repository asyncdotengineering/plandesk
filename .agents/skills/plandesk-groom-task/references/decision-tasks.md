# kind: `decision`

A decision task is **ready** when whoever owns the outcome can answer from the
description alone — no session history, no author to ask.

| field | ready when | not ready when |
| --- | --- | --- |
| **Question** | one question, answerable yes/no or by choosing among stated options | several questions bundled; a topic rather than a question |
| **Why it is open** | what forces the choice — the constraint or conflict, and what breaks either way | "we should decide this"; no stated cost of deciding wrong |
| **Options** | each with its cost, named concretely | one option; options that are not mutually exclusive |
| **Recommendation** | a proposed answer with reasoning | absent — a question with no proposal is a fork the agent is dodging |
| **Consequences** | what becomes true, and what it closes off | absent |
| **References** | the tasks and documents waiting on this | a dangling mention |

**Interfaces and Pseudocode are not required of a decision task.** A reader who
knows only the build bar will otherwise apply it and mark every decision task
not-ready forever.

The validation contract is fixed for every decision task — grooming states it
once rather than re-deriving it:

> Done when a `Decision:` document exists in the project's `Decisions` folder
> recording context, the call and its consequences; it is linked to this task;
> and every task that referenced this question links to it.

Grooming never invents an answer — a recommendation is a proposal for a human
to disagree with, not a resolution.

Failing any row is not ready. Name the row and the reason.
