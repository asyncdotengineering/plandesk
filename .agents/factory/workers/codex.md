---
type: worker
probe: command -v codex
command: codex exec -C {repo_path} --model gpt-5.6-luna -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --skip-git-repo-check "$(cat {prompt_file})" < /dev/null
---

# codex

Adversarial review and live-smoke worker. **No longer the default reviewer** —
that is `pi` on `zai`/`glm-5.2` as of 2026-08-02; see
[../routing.md](../routing.md) for why. Use `codex` as the review fallback when
`pi`'s probe fails, or when a task explicitly names it. The three bypass flags are
mandatory in every mode: a sandboxed codex cannot bind sockets, reach the
network, run the suite, or write its result claims. Never substitute
`--sandbox read-only`/`workspace-write` (only for genuinely untrusted
third-party code). Verify flags against your installed version
(`codex exec --help`).

**`< /dev/null` is mandatory** — `codex exec` otherwise prints "Reading
additional input from stdin…" and hangs when backgrounded. Prompt is passed as
`"$(cat {prompt_file})"`, not stdin.

**Model: `gpt-5.6-luna` at `high` reasoning.** Pinned here so every dispatch
uses the same one and it does not drift with whatever was last selected
interactively. Change it in this file, not in a brief — a model chosen per
dispatch is a model nobody can audit afterwards.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Then substitute the
placeholders — `{prompt_file}` with the brief path, `{repo_path}` with the
absolute repo or worktree path — and dispatch per
[../protocol.md](../protocol.md), which appends the log redirect and
backgrounds the run. Change the flags here, never in a brief. The result
contract is defined in the same file.
