/**
 * Generate the prototype-skill libraries reference from LIBRARY_MANIFEST.
 * Hand-writing this section drifts; tests assert byte-equality with the file.
 * Table columns are padded to match Prettier's markdown table layout so the
 * generated file stays `prettier --check`-clean.
 */
import { LIBRARY_MANIFEST } from '@plandesk/db';

function pad(value: string, width: number, align: 'left' | 'right'): string {
  if (align === 'right') {
    return value.padStart(width, ' ');
  }
  return value.padEnd(width, ' ');
}

function separator(width: number, align: 'left' | 'right'): string {
  if (align === 'right') {
    return `${'-'.repeat(Math.max(width - 1, 1))}:`.padStart(width, '-');
  }
  return '-'.repeat(width);
}

export function buildPrototypeLibrariesMarkdown(): string {
  const headers = ['name', 'version', 'license', 'bytes', 'ref'] as const;
  const aligns: Array<'left' | 'right'> = ['left', 'left', 'left', 'right', 'left'];

  const rows = LIBRARY_MANIFEST.map((entry) => {
    const ref = `\`plandesk://lib/${entry.name}@${entry.version}\``;
    return [entry.name, entry.version, entry.license, String(entry.bytes), ref];
  });

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );

  const headerLine = `| ${headers.map((h, i) => pad(h, widths[i] ?? 0, aligns[i] ?? 'left')).join(' | ')} |`;
  const sepLine = `| ${widths.map((w, i) => separator(w, aligns[i] ?? 'left')).join(' | ')} |`;
  const bodyLines = rows.map(
    (row) =>
      `| ${row.map((cell, i) => pad(cell, widths[i] ?? 0, aligns[i] ?? 'left')).join(' | ')} |`,
  );

  const lines: string[] = [
    '# Available libraries',
    '',
    'Generated from `LIBRARY_MANIFEST` (`@plandesk/db`). Do not edit by hand —',
    'regenerate via `buildPrototypeLibrariesMarkdown()` when the manifest changes.',
    '',
    'Reference a library in a screen with:',
    '',
    '```html',
    '<script src="plandesk://lib/<name>@<version>"></script>',
    '```',
    '',
    'Only these versions are served. A CDN URL or any other host is refused at',
    "write time and blocked at runtime (`connect-src 'none'`).",
    '',
    headerLine,
    sepLine,
    ...bodyLines,
  ];

  return `${lines.join('\n')}\n`;
}
