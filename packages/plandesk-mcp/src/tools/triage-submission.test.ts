import { describe, expect, it, vi } from 'vitest';
import { InvalidTriageError, InvalidTriageInputError } from '@plandesk/api';
import type { SyncService } from '@plandesk/api';
import { createTriageSubmissionHandler } from './triage-submission.js';

const submission = {
  id: 'sub-1',
  project_id: 'project-1',
  hosted_share_id: 'hosted-share-1',
  participant_name: 'Alex',
  title: 'Bug report',
  body: null,
  severity: null,
  task_ref: null,
  status: 'pending' as const,
  linked_task_id: null,
  created_at: '2026-01-15T12:00:00.000Z',
  pulled_at: '2026-01-15T12:00:00.000Z',
};

const remote = {
  serverUrl: 'https://sync.example',
  globalProjectId: 'gid-1',
  syncToken: 'plandesk_sync_test',
};

function createMockSyncService(triage: ReturnType<typeof vi.fn>) {
  return {
    getSubmission: vi.fn().mockReturnValue(submission),
    getRemote: vi.fn().mockReturnValue(remote),
    triage,
  } as unknown as SyncService;
}

describe('createTriageSubmissionHandler', () => {
  it('passes link_task_id through to syncService.triage', async () => {
    const triage = vi.fn().mockResolvedValue({ ...submission, status: 'accepted' });
    const handler = createTriageSubmissionHandler(createMockSyncService(triage));

    const result = await handler({
      submission_id: 'sub-1',
      action: 'accept',
      link_task_id: 'task-1',
    });

    expect(triage).toHaveBeenCalledWith('sub-1', 'accept', remote, undefined, 'task-1');
    expect(result.isError).not.toBe(true);
  });

  it('maps InvalidTriageInputError to a tool invalid_argument error', async () => {
    const triage = vi.fn().mockRejectedValue(new InvalidTriageInputError('mutually exclusive'));
    const handler = createTriageSubmissionHandler(createMockSyncService(triage));

    const result = await handler({
      submission_id: 'sub-1',
      action: 'accept',
      as_task: { label: 'New task' },
      link_task_id: 'task-1',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('invalid_argument');
    expect(result.content[0]?.text).toContain('mutually exclusive');
  });

  it('still maps InvalidTriageError to a not_found tool error', async () => {
    const triage = vi.fn().mockRejectedValue(new InvalidTriageError());
    const handler = createTriageSubmissionHandler(createMockSyncService(triage));

    const result = await handler({ submission_id: 'sub-1', action: 'accept' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not_found');
  });
});
