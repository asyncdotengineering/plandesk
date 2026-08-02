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
