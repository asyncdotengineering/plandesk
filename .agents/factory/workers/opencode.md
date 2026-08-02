---
type: worker
probe: command -v opencode
command: opencode run --dangerously-skip-permissions --dir {repo_path} -m opencode-go/kimi-k2.7-code < {prompt_file}
---

# opencode

End-to-end implementation worker across one subscription (Kimi / GLM /
MiniMax / DeepSeek / Anthropic / OpenAI). `--dangerously-skip-permissions`
prevents approval stalls; `-m <provider/model>` is mandatory — the default
agent drifts between runs. stdin IS the prompt (do not add `< /dev/null`).
Swap the model id from `opencode models`; verify flags with
`opencode run --help`.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Then substitute the
placeholders — `{prompt_file}` with the brief path, `{repo_path}` with the
absolute repo or worktree path — and dispatch per
[../protocol.md](../protocol.md), which appends the log redirect and
backgrounds the run. Change the flags here, never in a brief. The result
contract is defined in the same file.
