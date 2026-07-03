---
type: worker
probe: command -v opencode
command: opencode run < {prompt_file}
---

# opencode

End-to-end implementation worker. Verify flags against your installed
version (`opencode --help`).

Dispatch rule: run `probe` first — if it fails, this worker does not exist on
this machine; pick another file in this directory. Substitute {prompt_file}
with the brief path and run `command` verbatim. The result contract is
defined in [../protocol.md](../protocol.md).
