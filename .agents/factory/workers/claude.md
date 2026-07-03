---
type: worker
probe: command -v claude
command: claude --dangerously-skip-permissions -p < {prompt_file}
---

# claude

Default implementation worker. Uses the session-default model; append
`--model sonnet` (the alias, not a dated id) to pin standard-context Sonnet.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
