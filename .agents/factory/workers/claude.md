---
type: worker
probe: command -v claude
version: claude --version
command: claude --dangerously-skip-permissions --model sonnet -p < {prompt_file}
headless: claude --print --output-format stream-json --verbose --permission-mode bypassPermissions --model sonnet < {prompt_file}
---

# claude

Implementation worker. Which worker is the default IC is routing data, not a
worker-file fact — see [../routing.md](../routing.md). **`--model sonnet`** is pinned in the command
(the alias, not a dated id; never a `[1m]` variant). stdin IS the prompt — do
not add `< /dev/null`.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Then substitute the
placeholders — `{prompt_file}` with the brief path, `{repo_path}` with the
absolute repo or worktree path — and dispatch per
[../protocol.md](../protocol.md), which appends the log redirect and
backgrounds the run. Change the flags here, never in a brief. The result
contract is defined in the same file.
