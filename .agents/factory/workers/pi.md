---
type: worker
probe: command -v pi
command: pi -p --provider zai --model glm-5.2 --approve --thinking medium @{prompt_file}
---

# pi

Implementation worker. Delivers the brief via pi's `@file` attachment
syntax — not stdin. Pick the provider/model per task:

- `zai`/`glm-5.2` (DEFAULT — ZhipuAI direct API, 1M ctx) — general
  implementation. Requires `ZAI_API_KEY`.
- `opencode-go`/`kimi-k2.7-code` (262K, image-capable) — agentic,
  multi-step work. Requires `OPENCODE_API_KEY` (or `pi /login`).
- `deepseek`/`deepseek-v4-pro` (1M ctx) — long-context, deep reasoning;
  `deepseek-v4-flash` for fast/cheap runs. Requires `DEEPSEEK_API_KEY`.

`--approve` trusts project-local skills/extensions; `--thinking` sets
reasoning depth (`off|minimal|low|medium|high|xhigh`). Live list:
`pi --list-models`.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
