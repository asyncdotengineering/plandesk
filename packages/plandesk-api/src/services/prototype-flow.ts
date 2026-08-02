/**
 * Seeded flow-document body for a new prototype.
 *
 * Inferred: column set (screen · purpose · states / from · to · trigger) is
 * the groomer's proposal — unconfirmed against a real prototype.
 */
export function seededFlowDocumentBody(prototypeName: string): string {
  return [
    `# Design: ${prototypeName} flow`,
    '',
    'Status: Ready to implement',
    '',
    '## Screens',
    '',
    '| Screen | Purpose | States it must show |',
    '| --- | --- | --- |',
    '|  |  |  |',
    '',
    '## Transitions',
    '',
    '| From | To | Trigger |',
    '| --- | --- | --- |',
    '|  |  |  |',
    '',
  ].join('\n');
}

export function flowDocumentTitle(prototypeName: string): string {
  return `Design: ${prototypeName} flow`;
}

/** Same case rule as resolveTarget title matching. */
function titleMatches(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

export type PlannedScreen = {
  name: string;
  purpose: string;
  states: string[];
};

export type FlowCoverage = {
  /** false when the screens table cannot be found / parsed. */
  parseable: boolean;
  parse_error: string | null;
  planned: string[];
  built: string[];
  missing: string[];
  unplanned: string[];
  states_unverified: { screen: string; states: string[] }[];
  /** Built-but-unplanned is information, not an error — hint for the author. */
  unplanned_note: string | null;
};

const EMPTY_COVERAGE = (parseError: string): FlowCoverage => ({
  parseable: false,
  parse_error: parseError,
  planned: [],
  built: [],
  missing: [],
  unplanned: [],
  states_unverified: [],
  unplanned_note: null,
});

/**
 * Parse the seeded screens table from a flow document body.
 * Returns null when no recognizable screens table is present — callers must
 * report unparseable rather than full coverage.
 */
export function parseFlowScreensTable(body: string): PlannedScreen[] | null {
  const lines = body.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (/^\|\s*Screen\s*\|\s*Purpose\s*\|\s*States it must show\s*\|$/i.test(line)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return null;
  }

  const separator = lines[headerIdx + 1]?.trim() ?? '';
  if (!/^\|[\s|:-]+\|$/.test(separator)) {
    return null;
  }

  const planned: PlannedScreen[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const raw = lines[i]?.trim() ?? '';
    if (raw === '' || !raw.startsWith('|')) {
      break;
    }
    if (/^##\s/.test(raw)) {
      break;
    }
    const cells = raw
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) {
      continue;
    }
    const name = cells[0] ?? '';
    const purpose = cells[1] ?? '';
    const statesRaw = cells[2] ?? '';
    if (name === '' && purpose === '' && statesRaw === '') {
      continue;
    }
    if (name === '') {
      continue;
    }
    const states = statesRaw
      .split(/[,;/]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    planned.push({ name, purpose, states });
  }

  return planned;
}

/**
 * Compare a flow document to the prototype's built screens.
 * Title matching is case-insensitive (same rule as link resolution).
 */
export function computeFlowCoverage(
  flowBody: string | null | undefined,
  builtTitles: readonly string[],
): FlowCoverage {
  if (flowBody === null || flowBody === undefined || flowBody.trim() === '') {
    return EMPTY_COVERAGE('no flow document body');
  }

  const plannedRows = parseFlowScreensTable(flowBody);
  if (plannedRows === null) {
    return EMPTY_COVERAGE('no screens table found');
  }

  const planned = plannedRows.map((r) => r.name);
  const built = [...builtTitles];

  const missing: string[] = [];
  for (const name of planned) {
    if (!built.some((t) => titleMatches(t, name))) {
      missing.push(name);
    }
  }

  const unplanned: string[] = [];
  for (const title of built) {
    if (!planned.some((n) => titleMatches(n, title))) {
      unplanned.push(title);
    }
  }

  // States are a human checklist — markup cannot prove an empty state exists.
  const states_unverified = plannedRows
    .filter((r) => r.states.length > 0 && built.some((t) => titleMatches(t, r.name)))
    .map((r) => ({ screen: r.name, states: r.states }));

  return {
    parseable: true,
    parse_error: null,
    planned,
    built,
    missing,
    unplanned,
    states_unverified,
    unplanned_note:
      unplanned.length > 0
        ? 'Built screens absent from the flow document are information, not errors — update the flow document.'
        : null,
  };
}
