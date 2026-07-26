import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// macOS is case-insensitive: a lowercase `skill.md` works here and breaks only
// on Linux CI / consumer machines. Catch it mechanically.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skillsRoot = join(repoRoot, '.agents', 'skills');

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(full);
    } else {
      // Follow directory-style entries that readdir may not mark as directories.
      try {
        if (statSync(full).isDirectory()) {
          out.push(...walkFiles(full));
        } else {
          out.push(full);
        }
      } catch {
        out.push(full);
      }
    }
  }
  return out;
}

describe('curator skill file names', () => {
  it('no lowercase skill.md exists under .agents/skills/', () => {
    const files = walkFiles(skillsRoot);
    const lowercase = files.filter((f) => {
      const base = f.split(/[/\\]/).pop() ?? '';
      return base === 'skill.md';
    });
    expect(lowercase, `lowercase skill.md must not exist: ${lowercase.join(', ')}`).toEqual([]);
  });

  it('every curator skill directory ships uppercase SKILL.md', () => {
    const curatorDirs = readdirSync(skillsRoot, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name.startsWith('curator-'),
    );
    expect(curatorDirs.length).toBe(6);
    for (const dir of curatorDirs) {
      const skillPath = join(skillsRoot, dir.name, 'SKILL.md');
      expect(statSync(skillPath).isFile() || statSync(skillPath).isSymbolicLink()).toBe(true);
      // Case-sensitive name check via readdir — not via existsSync (macOS folds case).
      const names = readdirSync(join(skillsRoot, dir.name));
      expect(names, dir.name).toContain('SKILL.md');
      expect(names, dir.name).not.toContain('skill.md');
    }
  });
});
