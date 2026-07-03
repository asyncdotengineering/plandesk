# Agent workspace

Harness-neutral agent artifacts for this repository, discovered by path.
Consumers must tolerate unknown types, unknown frontmatter keys, and links to
not-yet-written files.

- [factory/factory.md](factory/factory.md) - the factory contract: how delegated agent work cycles run here
- [factory/protocol.md](factory/protocol.md) - the deterministic dispatch + result contract for worker CLIs
- [factory/workers/](factory/workers/) - one file per worker: probe (is it installed?) + command template
- [factory/lanes.md](factory/lanes.md) - risk-lane policy: which changes need which human gates
- [factory/verifiers/](factory/verifiers/) - fast per-change checks (exit 0 = pass)
- [skills/](skills/) - Agent Skills (SKILL.md directories) usable by any harness
