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

// Every shipped skill is `plandesk-*`: one prefix, one list. Splitting the
// roster by family (planning vs execution) was tried and dropped — two lists
// drift, and the scaffolding mechanism (write the file, symlink it) is
// identical either way. The bare `plandesk` skill is deliberately absent: it is
// `.plandesk/skill.md`, written by `connect`, not scaffolded by `factory init`.
/**
 * Skills vendored into a consumer's repo by `plandesk factory init` / `factory sync`.
 *
 * `plandesk-prototype` is deliberately absent and must stay absent. It is a
 * project-local skill for authoring prototypes in THIS repo, kept as a real
 * directory under `.claude/skills/` rather than a symlink into `.agents/skills/`,
 * so the vendoring step never picks it up. Adding it here ships it to every
 * consumer — that is the change to not make.
 */
export const SHIPPED_SKILL_NAMES = [
  'plandesk-foreman',
  'plandesk-scope-work',
  'plandesk-groom-task',
  'plandesk-plan-writer',
  'plandesk-autonomy',
  'plandesk-timebox',
] as const;

export type ShippedSkillName = (typeof SHIPPED_SKILL_NAMES)[number];

/** Relative symlink target from `.claude/skills/<name>/SKILL.md` → canonical skill. */
export function skillSymlinkTarget(name: string): string {
  return `../../../.agents/skills/${name}/SKILL.md`;
}

export const SHIPPED_TEMPLATES: ShippedTemplate[] = [
  ...SHIPPED_SKILL_NAMES.map((name) => shippedTemplate(`skills/${name}/SKILL.md`)),
  shippedTemplate('factory/hooks/session-start.sh', true),
  shippedTemplate('factory/hooks/checkpoint.sh', true),
  shippedTemplate('factory/hooks/settings.snippet.json'),
  shippedTemplate('factory/hooks/README.md'),
];

/** Settings snippet used by `mergeHooksJson` during factory init. */
export const HOOKS_SETTINGS_SNIPPET_JSON = readTemplate(
  'factory/hooks/settings.snippet.json',
);

/** Absolute path for a shipped template in a target repo. */
export function agentsArtifactPath(repoDir: string, relativePath: string): string {
  return join(repoDir, AGENTS_DIR, relativePath);
}
