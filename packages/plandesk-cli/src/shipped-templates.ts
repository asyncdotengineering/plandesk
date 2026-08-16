// Shipped skill + hook artifacts: file-backed under vendored `.agents/`
// (see `templates.ts`). Skills live at `.agents/skills/<name>/SKILL.md` with
// harness-discoverable `name` + `description` frontmatter; hooks live under the
// owned `.agents/factory/hooks/` subtree.

import { join } from 'node:path';
import { readTemplate } from './templates.js';

/** Repo-relative directory that owns all scaffolded files under `.agents/`. */
export const AGENTS_DIR = '.agents';

export type ShippedTemplate = {
  /** Path relative to `.agents/` (e.g. `skills/plandesk-scope-work/SKILL.md`). */
  relativePath: string;
  content: string;
  executable?: boolean;
};

function shippedTemplate(relativePath: string, executable?: boolean): ShippedTemplate {
  return {
    relativePath,
    content: readTemplate(relativePath),
    ...(executable === true ? { executable: true } : {}),
  };
}

// One roster, one list. Splitting it by family (planning vs execution) was
// tried and dropped — two lists drift, and the scaffolding mechanism (write the
// file, symlink it) is identical either way. The bare `plandesk` skill belongs
// here too: it is a shipped SKILL.md like the rest, and `connect` reads that
// same file to write `.plandesk/skill.md`. It was previously excluded, which
// left its text compiled into the CLI as a second, drifting source.
/**
 * Skills vendored into a consumer's repo by `plandesk factory init` / `factory sync`.
 *
 * `plandesk-prototype` ships with the rest: prototypes are a consumer-facing
 * devtool feature, and the generated `.plandesk/skill.md` points at this skill
 * for the authoring loop. A consumer that does not receive it follows a
 * dangling reference.
 */
export const SHIPPED_SKILL_NAMES = [
  // The MCP conventions skill. Bare `plandesk` where the rest are `plandesk-<verb>`,
  // because it is the surface itself rather than a procedure over it. It doubles as
  // the source `connect` reads to write .plandesk/skill.md.
  'plandesk',
  'plandesk-foreman',
  'plandesk-scope-work',
  'plandesk-groom-task',
  'plandesk-plan-writer',
  'plandesk-autonomy',
  'plandesk-timebox',
  'plandesk-standdown',
  'plandesk-standup',
  'plandesk-prototype',
] as const;

export type ShippedSkillName = (typeof SHIPPED_SKILL_NAMES)[number];

/**
 * Files a skill ships beyond its SKILL.md, relative to the skill directory.
 *
 * A skill whose guidance is split across references must ship them too —
 * otherwise the SKILL.md a consumer receives points at files they do not have.
 */
export const SHIPPED_SKILL_EXTRA_FILES: Partial<Record<ShippedSkillName, readonly string[]>> = {
  'plandesk-prototype': ['references/libraries.md'],
};

/** Every shipped file of a skill, relative to the skill directory. */
export function shippedSkillFiles(name: ShippedSkillName): readonly string[] {
  return ['SKILL.md', ...(SHIPPED_SKILL_EXTRA_FILES[name] ?? [])];
}

/**
 * Relative symlink target from `.claude/skills/<name>/<relPath>` → the canonical
 * file under `.agents/`. Depth is `.claude` + `skills` + `<name>`, plus one more
 * level for each directory inside `relPath`.
 */
export function skillSymlinkTarget(name: string, relPath = 'SKILL.md'): string {
  const up = '../'.repeat(2 + relPath.split('/').length);
  return `${up}.agents/skills/${name}/${relPath}`;
}

export const SHIPPED_TEMPLATES: ShippedTemplate[] = [
  ...SHIPPED_SKILL_NAMES.flatMap((name) =>
    shippedSkillFiles(name).map((rel) => shippedTemplate(`skills/${name}/${rel}`)),
  ),
  shippedTemplate('factory/hooks/session-start.sh', true),
  shippedTemplate('factory/hooks/checkpoint.sh', true),
  shippedTemplate('factory/hooks/settings.snippet.json'),
  shippedTemplate('factory/hooks/README.md'),
];

/** Settings snippet used by `mergeHooksJson` during factory init. */
export const HOOKS_SETTINGS_SNIPPET_JSON = readTemplate('factory/hooks/settings.snippet.json');

/** Absolute path for a shipped template in a target repo. */
export function agentsArtifactPath(repoDir: string, relativePath: string): string {
  return join(repoDir, AGENTS_DIR, relativePath);
}
