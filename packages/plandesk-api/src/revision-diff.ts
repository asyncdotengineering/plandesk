import { structuredPatch } from 'diff';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export type DiffHunk = {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: string[];
};

export type FieldDiff = {
  field: string;
  hunks: DiffHunk[];
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.use(gfm);

/** Project stored HTML body to Markdown for human-readable diffs. */
export function htmlToMarkdown(html: string): string {
  if (html.trim() === '') {
    return '';
  }
  return turndown.turndown(html).trimEnd();
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Line-diff two field values. Document `body` is projected through turndown
 * first; every other versioned field diffs as plain text.
 */
export function diffFieldValues(
  field: string,
  oldValue: unknown,
  newValue: unknown,
  options: { projectBodyAsMarkdown: boolean },
): FieldDiff | undefined {
  const oldText =
    field === 'body' && options.projectBodyAsMarkdown
      ? htmlToMarkdown(asText(oldValue))
      : asText(oldValue);
  const newText =
    field === 'body' && options.projectBodyAsMarkdown
      ? htmlToMarkdown(asText(newValue))
      : asText(newValue);

  if (oldText === newText) {
    return undefined;
  }

  // structuredPatch emits "\ No newline at end of file" markers when inputs
  // lack a trailing newline; normalize so hunks stay readable line diffs.
  const oldNormalized = oldText.endsWith('\n') ? oldText : `${oldText}\n`;
  const newNormalized = newText.endsWith('\n') ? newText : `${newText}\n`;

  const patch = structuredPatch(field, field, oldNormalized, newNormalized, undefined, undefined, {
    context: 3,
  });
  return {
    field,
    hunks: patch.hunks.map((hunk) => ({
      old_start: hunk.oldStart,
      old_lines: hunk.oldLines,
      new_start: hunk.newStart,
      new_lines: hunk.newLines,
      lines: hunk.lines,
    })),
  };
}

/** Diff every key present in either snapshot; omit unchanged fields. */
export function diffSnapshots(
  oldSnapshot: Record<string, unknown>,
  newSnapshot: Record<string, unknown>,
  options: { projectBodyAsMarkdown: boolean; fieldName: (key: string) => string },
): FieldDiff[] {
  const keys = new Set([...Object.keys(oldSnapshot), ...Object.keys(newSnapshot)]);
  const diffs: FieldDiff[] = [];
  for (const key of [...keys].sort()) {
    const fieldDiff = diffFieldValues(key, oldSnapshot[key], newSnapshot[key], {
      projectBodyAsMarkdown: options.projectBodyAsMarkdown,
    });
    if (fieldDiff === undefined) {
      continue;
    }
    diffs.push({ ...fieldDiff, field: options.fieldName(key) });
  }
  return diffs;
}
