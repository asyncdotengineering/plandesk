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
- [curator/triage.md](curator/triage.md) - source-agnostic auto-triage: raw signal → house-style `scope` tasks with provenance
- [curator/provenance.md](curator/provenance.md) - the provenance convention every Curator decision must carry
- [curator/automation.md](curator/automation.md) - schedule + board-event triggers for the triage skill, and the confidence gate
- [curator/intake.md](curator/intake.md) - idea/RFC → `scaffold_project_from_plan` planning methodology
- [curator/autonomy.md](curator/autonomy.md) - vendored, board-bound autonomy posture (drives `get_next_task`, stops at lane gates)
- [curator/hooks/](curator/hooks/) - board-as-memory hook scripts (`SessionStart`/`Stop`/`PreCompact`) called from project `.claude/settings.json`
