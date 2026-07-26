// Shipped skill + hook artifacts: file-backed under vendored `.agents/`
// (see `templates.ts`). Skills live at `.agents/skills/<name>/SKILL.md` with
// harness-discoverable `name` + `description` frontmatter; hooks live under the
// owned `.agents/factory/hooks/` subtree.

import { join } from 'node:path';
import { readTemplate } from './templates.js';

/** Repo-relative directory that owns all curator-scaffolded files under `.agents/`. */
export const AGENTS_DIR = '.agents';

export type CuratorTemplate = {
  /** Path relative to `.agents/` (e.g. `skills/curator-triage/SKILL.md`). */
  relativePath: string;
  content: string;
  executable?: boolean;
};

function curatorTemplate(relativePath: string, executable?: boolean): CuratorTemplate {
  return {
    relativePath,
    content: readTemplate(relativePath),
    ...(executable === true ? { executable: true } : {}),
  };
}

// Two families ship here: `curator-*` plans, `factory-*` executes. They share
// one list rather than a parallel one per family, because two lists drift and
// the scaffolding mechanism (write the file, symlink it) is identical.
export const SHIPPED_SKILL_NAMES = [
  'factory-foreman',
  'curator-triage',
  'curator-provenance',
  'curator-automation',
  'curator-intake',
  'curator-plan-writer',
  'curator-autonomy',
] as const;

export type ShippedSkillName = (typeof SHIPPED_SKILL_NAMES)[number];

/** Relative symlink target from `.claude/skills/<name>/SKILL.md` → canonical skill. */
export function curatorSkillSymlinkTarget(name: string): string {
  return `../../../.agents/skills/${name}/SKILL.md`;
}

export const CURATOR_TEMPLATES: CuratorTemplate[] = [
  ...SHIPPED_SKILL_NAMES.map((name) => curatorTemplate(`skills/${name}/SKILL.md`)),
  curatorTemplate('factory/hooks/session-start.sh', true),
  curatorTemplate('factory/hooks/checkpoint.sh', true),
  curatorTemplate('factory/hooks/settings.snippet.json'),
  curatorTemplate('factory/hooks/README.md'),
];

/** Settings snippet used by `mergeCuratorHooksJson` during factory init. */
export const CURATOR_HOOKS_SETTINGS_SNIPPET_JSON = readTemplate(
  'factory/hooks/settings.snippet.json',
);

/** Absolute path for a curator template in a target repo. */
export function curatorArtifactPath(repoDir: string, relativePath: string): string {
  return join(repoDir, AGENTS_DIR, relativePath);
}
