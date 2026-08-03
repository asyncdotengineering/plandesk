---
type: worker
probe: command -v cursor-agent
command: cursor-agent -p --force --trust --model composer-2.5 --sandbox disabled --approve-mcps --workspace {repo_path} --output-format text < {prompt_file}
---

# cursor

Alternative implementation worker. stdin IS the prompt — do not add
`< /dev/null`.

**Model: `composer-2.5`, locked.** Never dispatch Cursor on any other model, and
never use `--model auto`. Pinned here so every dispatch uses the same one and it
does not drift with whatever was last selected interactively. Change it in this
file, not in a brief — a model chosen per dispatch is a model nobody can audit
afterwards, and `auto` re-picks per turn, so a weak result cannot be told apart
from a weak draw.

**A different model is a routing decision, not a Cursor flag.** When a task wants
another model, dispatch the worker built for it rather than re-pointing Cursor:

| want | worker |
| --- | --- |
| GPT-5.6 (`luna` / `sol`) | [codex](codex.md) |
| Sonnet / Opus | [claude](claude.md) |
| Grok | [grok](grok.md) |
| DeepSeek, GLM, Kimi, MiniMax | [pi](pi.md) |

Routing lives in [../routing.md](../routing.md).

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Then substitute the
placeholders — `{prompt_file}` with the brief path, `{repo_path}` with the
absolute repo or worktree path — and dispatch per
[../protocol.md](../protocol.md), which appends the log redirect and
backgrounds the run. Change the flags here, never in a brief. The result
contract is defined in the same file.
