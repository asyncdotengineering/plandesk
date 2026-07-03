---
type: worker
probe: command -v cursor-agent
command: cursor-agent -p --force --trust --model auto --sandbox disabled --approve-mcps < {prompt_file}
---

# cursor

Alternative implementation worker with per-turn model routing. Keep
`--model auto`; never pin a model on Cursor for unsupervised work.

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
