---
type: worker
probe: command -v claude
command: claude --dangerously-skip-permissions -p < {prompt_file}
---

# claude

Default implementation worker. Uses the session-default model; append
`--model sonnet` (the alias, not a dated id) to pin standard-context Sonnet.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Then substitute the
placeholders — `{prompt_file}` with the brief path, `{repo_path}` with the
absolute repo or worktree path — and dispatch per
[../protocol.md](../protocol.md), which appends the log redirect and
backgrounds the run. Change the flags here, never in a brief. The result
contract is defined in the same file.
