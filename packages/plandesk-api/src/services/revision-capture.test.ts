import { describe, expect, it } from 'vitest';
import {
  changedVersionedFields,
  DOCUMENT_VERSIONED_FIELDS,
  TASK_VERSIONED_FIELDS,
  versionedFieldSnapshot,
} from './revision-capture.js';

describe('revision-capture helpers', () => {
  it('detects changed versioned fields only when input carries them', () => {
    const prior = { label: 'A', description: 'old', status: 'todo' };
    expect(changedVersionedFields(prior, { label: 'B' }, TASK_VERSIONED_FIELDS)).toEqual(['label']);
    expect(changedVersionedFields(prior, { label: 'A' }, TASK_VERSIONED_FIELDS)).toEqual([]);
    expect(changedVersionedFields(prior, { status: 'done' }, TASK_VERSIONED_FIELDS)).toEqual([]);
  });

  it('builds a complete versioned-field snapshot', () => {
    const prior = { title: 'T', body: null, statusLine: 'S', parentId: 'x' };
    expect(versionedFieldSnapshot(prior, DOCUMENT_VERSIONED_FIELDS)).toEqual({
      title: 'T',
      body: null,
      statusLine: 'S',
    });
  });
});
