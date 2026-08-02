import { describe, expect, it } from 'vitest';
import {
  computeFlowCoverage,
  parseFlowScreensTable,
  seededFlowDocumentBody,
} from './prototype-flow.js';

describe('parseFlowScreensTable', () => {
  it('parses the seeded screens table shape', () => {
    const body = [
      '# Design: Checkout flow',
      '',
      '## Screens',
      '',
      '| Screen | Purpose | States it must show |',
      '| --- | --- | --- |',
      '| Cart | Review items | empty, filled |',
      '| Payment | Collect card | default, error |',
      '| Confirm | Done | success |',
      '',
      '## Transitions',
      '',
      '| From | To | Trigger |',
      '| --- | --- | --- |',
      '| Cart | Payment | Continue |',
    ].join('\n');

    expect(parseFlowScreensTable(body)).toEqual([
      { name: 'Cart', purpose: 'Review items', states: ['empty', 'filled'] },
      { name: 'Payment', purpose: 'Collect card', states: ['default', 'error'] },
      { name: 'Confirm', purpose: 'Done', states: ['success'] },
    ]);
  });

  it('returns null when there is no screens table (never empty-array green)', () => {
    expect(parseFlowScreensTable('# Just prose\n\nNo table here.')).toBeNull();
    expect(parseFlowScreensTable('')).toBeNull();
  });

  it('skips the blank seed row in seededFlowDocumentBody', () => {
    const planned = parseFlowScreensTable(seededFlowDocumentBody('X'));
    expect(planned).toEqual([]);
  });
});

describe('computeFlowCoverage', () => {
  const fourScreenDoc = [
    '| Screen | Purpose | States it must show |',
    '| --- | --- | --- |',
    '| Welcome | land | default |',
    '| Details | form | empty, filled |',
    '| Review | check | default |',
    '| Done | finish | success |',
  ].join('\n');

  it('names exactly the planned-but-missing screens', () => {
    const coverage = computeFlowCoverage(fourScreenDoc, ['Welcome', 'Details', 'Review']);
    expect(coverage.parseable).toBe(true);
    expect(coverage.missing).toEqual(['Done']);
    expect(coverage.unplanned).toEqual([]);
  });

  it('reports built-but-unplanned by name as information, not an error', () => {
    const coverage = computeFlowCoverage(fourScreenDoc, [
      'Welcome',
      'Details',
      'Review',
      'Done',
      'Surprise',
    ]);
    expect(coverage.unplanned).toEqual(['Surprise']);
    expect(coverage.unplanned_note).toMatch(/information, not errors/i);
    expect(coverage.missing).toEqual([]);
  });

  it('reports unparseable rather than full coverage when the table is absent', () => {
    const coverage = computeFlowCoverage('# no table', ['Welcome']);
    expect(coverage.parseable).toBe(false);
    expect(coverage.parse_error).toMatch(/no screens table/i);
    expect(coverage.missing).toEqual([]);
    expect(coverage.planned).toEqual([]);
    // Must not look like 100% coverage.
    expect(coverage.built).toEqual([]);
  });

  it('matches titles case-insensitively like link resolution', () => {
    const coverage = computeFlowCoverage(fourScreenDoc, ['welcome', 'DETAILS', 'review', 'done']);
    expect(coverage.missing).toEqual([]);
    expect(coverage.unplanned).toEqual([]);
  });
});
