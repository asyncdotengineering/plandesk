import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { SHIPPED_SKILL_NAMES, SHIPPED_TEMPLATES } from './shipped-templates.js';

// Claude Code's skill loader is lenient, so a frontmatter that only it can read
// looks fine here and is silently dropped by every strict consumer (the
// `skills` CLI, other agents). Parse the way the strictest consumer does.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skillsRoot = join(repoRoot, '.agents', 'skills');

// Descriptions load for every installed skill in every session; keep them a
// routing signal, not a manual. The agentskills.io hard limit is 1024.
const DESCRIPTION_BUDGET = 500;

type Frontmatter = { name?: unknown; description?: unknown; metadata?: { internal?: unknown } };

function frontmatter(markdown: string): Frontmatter {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (match === null) {
    throw new Error('no frontmatter block');
  }
  return parse(match[1] ?? '', { strict: true, uniqueKeys: true }) as Frontmatter;
}

const sourceSkills = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    dir: entry.name,
    markdown: readFileSync(join(skillsRoot, entry.name, 'SKILL.md'), 'utf8'),
  }));

describe('shipped skill frontmatter', () => {
  it.each(sourceSkills)('$dir parses as strict YAML with a matching name', ({ dir, markdown }) => {
    const fm = frontmatter(markdown);
    expect(fm.name).toBe(dir);
    expect(typeof fm.description).toBe('string');
    expect((fm.description as string).length).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
  });

  it('the repo source stays discoverable: no skill is marked internal here', () => {
    for (const { markdown } of sourceSkills) {
      expect(frontmatter(markdown).metadata?.internal).toBeUndefined();
    }
  });

  it('every vendored SKILL.md is marked internal so a connected repo does not advertise it', () => {
    const vendored = SHIPPED_TEMPLATES.filter((t) => t.relativePath.endsWith('/SKILL.md'));
    expect(vendored).toHaveLength(SHIPPED_SKILL_NAMES.length);
    for (const template of vendored) {
      const fm = frontmatter(template.content);
      expect(fm.metadata?.internal, template.relativePath).toBe(true);
      expect(typeof fm.description).toBe('string');
    }
  });

  it('autonomy and timebox route on different axes, sharing no trigger phrase', () => {
    const description = (dir: string): string =>
      String(frontmatter(sourceSkills.find((s) => s.dir === dir)?.markdown ?? '').description);
    // autonomy owns "don't stop to ask"; timebox owns "report every interval".
    expect(description('plandesk-autonomy').toLowerCase()).not.toContain('keep going');
    expect(description('plandesk-timebox').toLowerCase()).not.toContain('keep going');
  });
});

describe('skills.sh.json', () => {
  it('places every shipped skill in exactly one group', () => {
    const config = JSON.parse(readFileSync(join(repoRoot, 'skills.sh.json'), 'utf8')) as {
      groupings: { title: string; skills: string[] }[];
    };
    const grouped = config.groupings.flatMap((group) => group.skills);
    expect(grouped.slice().sort()).toEqual(SHIPPED_SKILL_NAMES.slice().sort());
  });
});
