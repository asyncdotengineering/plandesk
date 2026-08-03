import { afterEach, describe, expect, it } from 'vitest';
import {
  listGroupCollapseStorageKey,
  loadCollapsedGroupIds,
  saveCollapsedGroupIds,
} from './list-group-collapse.js';

const projectId = 'proj-1';

afterEach(() => {
  localStorage.clear();
});

describe('list-group-collapse', () => {
  it('round-trips collapsed group ids through localStorage', () => {
    const ids = new Set(['goal_id:g1/status:todo', 'goal_id:g2']);
    saveCollapsedGroupIds(projectId, ids);

    const raw = localStorage.getItem(listGroupCollapseStorageKey(projectId));
    expect(raw).toBeTruthy();

    const loaded = loadCollapsedGroupIds(projectId);
    expect(loaded).toEqual(ids);
  });

  it('returns null for missing or malformed storage', () => {
    expect(loadCollapsedGroupIds(projectId)).toBeNull();
    localStorage.setItem(listGroupCollapseStorageKey(projectId), 'not-json');
    expect(loadCollapsedGroupIds(projectId)).toBeNull();
    localStorage.setItem(listGroupCollapseStorageKey(projectId), JSON.stringify([1, 2]));
    expect(loadCollapsedGroupIds(projectId)).toBeNull();
  });
});
