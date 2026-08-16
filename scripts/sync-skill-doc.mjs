#!/usr/bin/env node
//
// The docs page `connecting-agents/skill.md` tells readers that `plandesk
// connect` writes "the same content" to `.plandesk/skill.md`. That was a claim
// with nothing enforcing it: the page was a hand-maintained copy of
// PLANDESK_SKILL_TEMPLATE, and it drifted — the shipped template gained typed
// edge endpoints and many-tasks-per-document while the page still told agents
// edges only join tasks.
//
// The template is the source of truth. This regenerates the page body from it,
// keeping only the page's own Astro frontmatter and preamble.
//
//   node scripts/sync-skill-doc.mjs           # rewrite the page
//   node scripts/sync-skill-doc.mjs --check   # fail if it is stale (CI gate)
//
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = join(root, 'apps/docs/src/content/docs/connecting-agents/skill.md');

// Read the template from source, not from a build artifact. This script used
// to import PLANDESK_SKILL_TEMPLATE from `plandesk-cli/dist/skill-template.js`;
// commit 6603a86 ("ship the conventions skill as a file, not a compiled
// string") deleted that module, and the gate failed with a misleading "build
// @plandesk/cli first" for every run afterwards. Reading the source removes
// the build dependency, so this can never fail for build-order reasons again.
//
// `copy-templates.mjs` vendors `.agents/` into `dist/templates/` verbatim, so
// the source file and the shipped one are the same bytes. The relative path
// mirrors PLANDESK_SKILL_TEMPLATE_PATH in
// `packages/plandesk-cli/src/connect-artifacts.ts`.
const SKILL_TEMPLATE_PATH = 'skills/plandesk/SKILL.md';
const templatePath = join(root, '.agents', SKILL_TEMPLATE_PATH);

if (!existsSync(templatePath)) {
  console.error(
    `sync-skill-doc: template not found at ${templatePath}\n` +
      '  If it moved, update SKILL_TEMPLATE_PATH here and PLANDESK_SKILL_TEMPLATE_PATH\n' +
      '  in packages/plandesk-cli/src/connect-artifacts.ts together.',
  );
  process.exit(1);
}

const PLANDESK_SKILL_TEMPLATE = readFileSync(templatePath, 'utf8');

/** The template carries its own skill frontmatter; the docs page has Astro's. */
function templateBody(text) {
  const withoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return withoutFrontmatter.trim();
}

/** Everything up to and including the `---` separator is the page's own preamble. */
function pagePreamble(text) {
  const marker = '\n---\n\n';
  const end = text.indexOf(marker, text.indexOf('\n---\n') + 5);
  if (end === -1) {
    console.error('sync-skill-doc: could not find the preamble separator in the docs page');
    process.exit(1);
  }
  return text.slice(0, end + marker.length);
}

const current = readFileSync(docPath, 'utf8');
const expected = `${pagePreamble(current)}${templateBody(PLANDESK_SKILL_TEMPLATE)}\n`;

if (process.argv.includes('--check')) {
  if (current !== expected) {
    console.error(
      'sync-skill-doc: apps/docs/.../connecting-agents/skill.md is stale.\n' +
        `  It must match .agents/${SKILL_TEMPLATE_PATH} — run: node scripts/sync-skill-doc.mjs`,
    );
    process.exit(1);
  }
  console.log('sync-skill-doc: docs skill page matches the shipped template');
} else if (current === expected) {
  console.log('sync-skill-doc: already up to date');
} else {
  writeFileSync(docPath, expected);
  console.log('sync-skill-doc: regenerated the docs skill page from the shipped template');
}
