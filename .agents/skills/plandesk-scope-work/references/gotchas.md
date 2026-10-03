# Gotchas

- `scaffold_project_from_plan` resolves `key`s, not IDs. Passing a real task ID
  in `edges.from` fails the whole atomic call.
- A brain-dump often contains both shapes — three unrelated bugs *and* one
  initiative. Split the input and run both modes rather than forcing one.
- `list_tasks(project_id)` without a status filter is what makes dedup work;
  filtering to `scope` hides the duplicate that is already `done`.
