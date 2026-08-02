import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPrototypeLibrariesMarkdown } from './prototype-libraries-md.js';
import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROTOTYPE_SKILL = join(REPO_ROOT, '.claude/skills/plandesk-prototype/SKILL.md');
const LIBRARIES_MD = join(REPO_ROOT, '.claude/skills/plandesk-prototype/references/libraries.md');

describe('plandesk-prototype skill', () => {
  const skill = readFileSync(PROTOTYPE_SKILL, 'utf8');

  it('contains no Skill(...) invocation and no instruction to invoke another skill by name', () => {
    expect(skill).not.toMatch(/Skill\s*\(/);
    expect(skill).not.toMatch(
      /\buse (the )?(design-reality-check|design-psychology|ux-strict-mobile|ux-pattern-composer|design-taste-frontend)\b/i,
    );
    expect(skill).not.toMatch(
      /\bcall (the )?(design-reality-check|design-psychology|ux-strict-mobile)\b/i,
    );
    expect(skill).not.toMatch(/\brun skill\b/i);
  });

  it('states purpose, flow-first, unhappy paths, and Forbidden', () => {
    expect(skill).toMatch(/interactive but deliberately not functional/i);
    expect(skill).toMatch(/Flow before screens/);
    expect(skill).toMatch(/Unhappy paths are \*\*mandatory\*\*/);
    expect(skill).toMatch(/## 5\. Forbidden/);
  });

  it('libraries.md matches LIBRARY_MANIFEST generation byte-for-byte', () => {
    const onDisk = readFileSync(LIBRARIES_MD, 'utf8');
    expect(onDisk).toBe(buildPrototypeLibrariesMarkdown());
    expect(onDisk).toContain('mermaid');
    expect(onDisk).toContain('11.16.0');
    expect(onDisk).toContain('chart.js');
    expect(onDisk).toContain('4.5.1');
  });
});

describe('PLANDESK_SKILL_TEMPLATE prototypes section', () => {
  it('documents the three plandesk:// schemes and points at the authoring skill', () => {
    expect(PLANDESK_SKILL_TEMPLATE).toMatch(/## Prototypes/);
    expect(PLANDESK_SKILL_TEMPLATE).toContain('plandesk://artifact/');
    expect(PLANDESK_SKILL_TEMPLATE).toContain('plandesk://file/');
    expect(PLANDESK_SKILL_TEMPLATE).toContain('plandesk://lib/');
    expect(PLANDESK_SKILL_TEMPLATE).toContain('move_screen');
    expect(PLANDESK_SKILL_TEMPLATE).toContain('copy_screen');
    expect(PLANDESK_SKILL_TEMPLATE).toContain('plandesk push-artifact');
    expect(PLANDESK_SKILL_TEMPLATE).toContain('.claude/skills/plandesk-prototype/SKILL.md');
    // Authoring Forbidden list stays in the skill, not duplicated here.
    expect(PLANDESK_SKILL_TEMPLATE).not.toMatch(/## 5\. Forbidden/);
  });
});
