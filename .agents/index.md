# Agent workspace

Harness-neutral agent artifacts for this repository, discovered by path.
Consumers must tolerate unknown types, unknown frontmatter keys, and links to
not-yet-written files.

- [factory/factory.md](factory/factory.md) - the factory contract: how delegated agent work cycles run here
- [factory/execution.md](factory/execution.md) - IC spine when typing the work: decompose, drive to zero, ship
- [factory/protocol.md](factory/protocol.md) - the deterministic dispatch + result contract for worker CLIs
- [factory/workers/](factory/workers/) - one file per worker: probe (is it installed?) + command template
- [factory/routing.md](factory/routing.md) - which worker for which task shape, and the cross-family review rule
- [factory/lanes.md](factory/lanes.md) - risk-lane policy: which changes need which human gates
- [factory/verifiers/](factory/verifiers/) - fast per-change checks (exit 0 = pass)
- [skills/](skills/) - Agent Skills (SKILL.md directories) usable by any harness
- [skills/curator-triage/SKILL.md](skills/curator-triage/SKILL.md) - source-agnostic auto-triage: raw signal → house-style `scope` tasks with provenance
- [skills/curator-provenance/SKILL.md](skills/curator-provenance/SKILL.md) - the provenance convention every Curator decision must carry
- [skills/curator-automation/SKILL.md](skills/curator-automation/SKILL.md) - schedule + board-event triggers for the triage skill, and the confidence gate
- [skills/curator-intake/SKILL.md](skills/curator-intake/SKILL.md) - idea/RFC → `scaffold_project_from_plan` planning methodology
- [skills/curator-plan-writer/SKILL.md](skills/curator-plan-writer/SKILL.md) - RFC / design proposal as a Plan Desk `Design:` document (upstream of curator-intake)
- [skills/curator-autonomy/SKILL.md](skills/curator-autonomy/SKILL.md) - vendored, board-bound autonomy posture (drives `get_next_task`, stops at lane gates)
- [factory/hooks/](factory/hooks/) - board-as-memory hook scripts (`SessionStart`/`Stop`/`PreCompact`) called from project `.claude/settings.json`
