---
type: worker
probe: command -v grok
command: grok --prompt-file {prompt_file} --always-approve --output-format plain
---

# grok

Fast implementation worker. Pin a model with `--model <id>` after
checking `grok models` for what is installed here.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
