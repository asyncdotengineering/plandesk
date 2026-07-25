---
type: worker
probe: command -v codex
command: codex exec --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --skip-git-repo-check < {prompt_file}
---

# codex

Adversarial review and live-smoke worker — prefer it as the reviewer
when the act worker is a Claude-family run. The three bypass flags are
mandatory in every mode: a sandboxed codex cannot bind sockets, reach the
network, run the suite, or write its result claims. Never substitute
`--sandbox read-only`/`workspace-write` (only for genuinely untrusted
third-party code). Verify flags against your installed version
(`codex exec --help`).

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
