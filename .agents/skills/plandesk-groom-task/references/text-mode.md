# `text` mode

`text` mode creates exactly one task, in `scope`, and never dedups a batch — a
pile of raw signal is [scope-work](../plandesk-scope-work/SKILL.md)'s job, not this one.
Before creating, call `list_tasks` once: if the requirement is already on the
board, say so and groom the existing task instead of adding a near-duplicate.
