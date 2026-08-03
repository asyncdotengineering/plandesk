---
type: worker
probe: command -v pi
command: pi -p --provider zai --model glm-5.2 --approve --thinking medium @{prompt_file} < /dev/null
---

# pi

Implementation worker **and the default reviewer** (decided 2026-08-02 — see
[../routing.md](../routing.md)). Every `full`-lane and adversarial review comes
here first; `codex` is the fallback if this probe fails.

Reviewing needs no flag change: the same `command` above serves both, because a
review brief is just a brief. Two things to keep in mind when it is reviewing —
raise `--thinking` to `high` for an adversarial pass, and remember its 1M
context is the reason it was chosen, so give it the whole diff rather than a
summary.

Delivers the brief via pi's `@file` attachment syntax — not stdin. **`< /dev/null`
is mandatory** on background fires. Pick the
provider/model per task:

- `zai`/`glm-5.2` (DEFAULT — ZhipuAI direct API, 1M ctx) — general
  implementation. Requires `ZAI_API_KEY`.
- `opencode-go`/`kimi-k2.7-code` (262K, image-capable) — agentic,
  multi-step work. Requires `OPENCODE_API_KEY` (or `pi /login`).
- `deepseek`/`deepseek-v4-pro` (1M ctx) — long-context, deep reasoning;
  `deepseek-v4-flash` for fast/cheap runs. Requires `DEEPSEEK_API_KEY`.

`--approve` trusts project-local skills/extensions; `--thinking` sets
reasoning depth (`off|minimal|low|medium|high|xhigh`). Live list:
`pi --list-models`.

**pi flushes its log in bulk, not line by line.** Observed: an empty log for
~10 minutes, then ~49KB at once, while the process worked throughout. Treat log
silence as no information for this worker and judge it on leaf CPU and file
mtimes instead — see the stall-detection notes in
[../protocol.md](../protocol.md).

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Then substitute the
placeholders — `{prompt_file}` with the brief path, `{repo_path}` with the
absolute repo or worktree path — and dispatch per
[../protocol.md](../protocol.md), which appends the log redirect and
backgrounds the run. Change the flags here, never in a brief. The result
contract is defined in the same file.
