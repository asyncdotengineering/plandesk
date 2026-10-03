# Converting a Design document into the WBS

**If the source is a Plan Desk document that already carries a decomposition
sketch, convert it — do not re-derive it.** A `Design:` document written by
[plan-writer](../plandesk-plan-writer/SKILL.md) ends with a numbered sketch of the
major pieces in landing order. That list *is* the WBS: read it with
`get_document`, create one task per entry in the order given, and link each back
to the source document.

Re-deriving a decomposition someone already reasoned through is how a plan
quietly becomes a different plan — the author's sequencing carried an argument,
and rebuilding it from the prose loses whichever part of that argument you did
not re-read. Split or merge an entry only when you can say why, and say so in
the task.

Everything below applies to entries that need work the sketch did not state, and
to sources with no sketch at all.
