import { describe, expect, it } from 'vitest';
import type { Project } from '@plandesk/db';
import { serializeProject } from './serialize.js';

function makeProject(currentGoalId: string | null): Project {
  return {
    id: 'proj-1',
    orgId: 'org-1',
    workspaceId: 'ws-1',
    name: 'Test project',
    description: null,
    ownerId: null,
    overviewDocumentId: null,
    repoUrl: null,
    folderPath: null,
    currentGoalId,
    canvasLayout: null,
    createdAt: new Date('2026-06-07T00:00:00.000Z'),
    updatedAt: new Date('2026-06-07T00:00:00.000Z'),
  };
}

describe('serializeProject', () => {
  it('carries current_goal_id so clients can default goal selection', () => {
    expect(serializeProject(makeProject('goal-9')).current_goal_id).toBe('goal-9');
  });

  it('serializes an unset current goal as null', () => {
    expect(serializeProject(makeProject(null)).current_goal_id).toBeNull();
  });
});
