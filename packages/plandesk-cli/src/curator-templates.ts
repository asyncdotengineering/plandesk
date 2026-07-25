// Curator skill artifacts: file-backed templates under the vendored `.agents/curator/`
// tree (see `templates.ts`). `factory init` scaffolds these verbatim into a fresh
// project. Descriptions for Claude Code skill adapters stay here — they are not
// on-disk prose files.

import { readTemplate } from './templates.js';

export const CURATOR_DIR = '.agents/curator';

export type CuratorTemplate = {
  relativePath: string;
  content: string;
  executable?: boolean;
};

function curatorTemplate(relativePath: string, executable?: boolean): CuratorTemplate {
  return {
    relativePath,
    content: readTemplate(`curator/${relativePath}`),
    ...(executable === true ? { executable: true } : {}),
  };
}

export const CURATOR_TEMPLATES: CuratorTemplate[] = [
  curatorTemplate('triage.md'),
  curatorTemplate('provenance.md'),
  curatorTemplate('automation.md'),
  curatorTemplate('intake.md'),
  curatorTemplate('plan-writer.md'),
  curatorTemplate('autonomy.md'),
  curatorTemplate('hooks/session-start.sh', true),
  curatorTemplate('hooks/checkpoint.sh', true),
  curatorTemplate('hooks/settings.snippet.json'),
  curatorTemplate('hooks/README.md'),
];

/** Settings snippet used by `mergeCuratorHooksJson` during factory init. */
export const CURATOR_HOOKS_SETTINGS_SNIPPET_JSON = readTemplate(
  'curator/hooks/settings.snippet.json',
);

type CuratorSkill = {
  slug: string;
  name: string;
  source: string;
  description: string;
};

// The curator skills live canonically under .agents/curator/ with harness-neutral
// `type: curator-skill` frontmatter. Claude Code only auto-discovers skills under
// .claude/skills/<name>/SKILL.md carrying `name` + `description` frontmatter, so
// factory init also generates a discoverable adapter per skill.
export const CURATOR_SKILLS: CuratorSkill[] = [
  {
    slug: 'triage',
    name: 'curator-triage',
    source: readTemplate('curator/triage.md'),
    description:
      'Turn raw signal — client submissions, an ungroomed backlog, or a pasted brain-dump — into deduped, house-style Plan Desk tasks in `scope`. Use when asked to triage the backlog or submissions, or to sort a brain-dump into tasks.',
  },
  {
    slug: 'provenance',
    name: 'curator-provenance',
    source: readTemplate('curator/provenance.md'),
    description:
      'The provenance convention (sources + reason) every Curator triage decision must carry. Reference when recording why a task exists or was merged.',
  },
  {
    slug: 'automation',
    name: 'curator-automation',
    source: readTemplate('curator/automation.md'),
    description:
      'Wire the Curator triage pass to a schedule and to board events (new submission, task lands in backlog). Use when setting up automatic or unattended triage.',
  },
  {
    slug: 'intake',
    name: 'curator-intake',
    source: readTemplate('curator/intake.md'),
    description:
      'Turn an idea or an RFC into a scaffolded Plan Desk project — tasks, dependency edges, lanes, and a Design doc — in one scaffold_project_from_plan call. Use when planning a new project or a substantial new initiative onto the board.',
  },
  {
    slug: 'plan-writer',
    name: 'curator-plan-writer',
    source: readTemplate('curator/plan-writer.md'),
    description:
      'Write an RFC / design proposal for a substantial change as a Plan Desk `Design:` document — a build contract carrying its own argument (problem, requirements, design, alternatives, verification surface). Use when asked to write an RFC, spec out a change, or draft a design doc before decomposing it; it is the upstream of curator-intake.',
  },
  {
    slug: 'autonomy',
    name: 'curator-autonomy',
    source: readTemplate('curator/autonomy.md'),
    description:
      "Board-bound, lane-gated autonomy posture for driving this project's Plan Desk board unattended without breaching the human gates. Use when running the board loop autonomously.",
  },
];

function stripFrontmatter(md: string): string {
  const match = md.match(/^---\n[\s\S]*?\n---\n/);
  return match ? md.slice(match[0].length).replace(/^\n+/, '') : md;
}

// Build a Claude-Code-discoverable SKILL.md adapter from a curator source file: swap
// the harness-neutral `type` frontmatter for the `name` + `description` Claude Code
// reads to decide when to load the skill.
export function buildCuratorSkillAdapter(
  source: string,
  name: string,
  description: string,
): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${stripFrontmatter(source)}`;
}
