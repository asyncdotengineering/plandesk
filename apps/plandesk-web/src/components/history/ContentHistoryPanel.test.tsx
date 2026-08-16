import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RevisionFieldDiff,
  SerializedRevision,
  SerializedRevisionMeta,
  SerializedTask,
} from '../../lib/api.js';
import { requestUrl } from '../../test-utils.js';
import { ContentHistoryPanel, formatRevisionAuthor, relativeTime } from './ContentHistoryPanel.js';

const projectId = 'proj-1';
const taskId = 'task-1';

const revisionA: SerializedRevisionMeta = {
  id: 'rev-a',
  author: 'human:alice',
  changed_fields: ['description'],
  created_at: '2026-07-01T12:00:00.000Z',
};

const revisionB: SerializedRevisionMeta = {
  id: 'rev-b',
  author: 'human:bob',
  changed_fields: ['description'],
  created_at: '2026-07-01T13:00:00.000Z',
};

const snapshotA: SerializedRevision = {
  ...revisionA,
  target_type: 'task',
  target_id: taskId,
  snapshot: { label: 'Card', description: 'first draft' },
};

const snapshotB: SerializedRevision = {
  ...revisionB,
  target_type: 'task',
  target_id: taskId,
  snapshot: { label: 'Card', description: 'second draft' },
};

const sampleDiff: RevisionFieldDiff[] = [
  {
    field: 'description',
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: ['-first draft', '+second draft'],
      },
    ],
  },
];

const restoredTask: SerializedTask = {
  id: taskId,
  project_id: projectId,
  goal_id: 'goal-1',
  label: 'Card',
  status: 'todo',
  priority: null,
  description: 'first draft',
  x: 0,
  y: 0,
  assignee: null,
  due_date: null,
  commit_refs: [],
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-07-01T14:00:00.000Z',
};

function isSnapshotGet(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return /^\/api\/v1\/revisions\/[^/]+$/.test(path);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) =>
    Promise.resolve(handler(requestUrl(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(props: Partial<ComponentProps<typeof ContentHistoryPanel>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContentHistoryPanel
        projectId={projectId}
        targetType="task"
        targetId={taskId}
        open
        onOpenChange={() => undefined}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // The cast is load-bearing, not laziness. lib.dom declares these four as
  // always present on Element, so assigning them directly makes `??=` an
  // "unnecessary condition" to eslint — while jsdom omits all four at runtime.
  // Widening to a record is what lets the polyfill say what is actually true.
  const el = window.Element.prototype as unknown as Record<string, unknown>;
  el.hasPointerCapture ??= vi.fn(() => false);
  el.setPointerCapture ??= vi.fn();
  el.releasePointerCapture ??= vi.fn();
  el.scrollIntoView ??= vi.fn();
});

describe('content-history helpers', () => {
  it('formats authors without inventing display ids', () => {
    expect(formatRevisionAuthor('human:alice')).toBe('alice');
    expect(formatRevisionAuthor('agent:run-42')).toBe('Agent run-42');
    expect(formatRevisionAuthor('system')).toBe('System');
  });

  it('renders relative times', () => {
    const now = Date.parse('2026-07-01T13:30:00.000Z');
    expect(relativeTime('2026-07-01T13:29:00.000Z', now)).toBe('1m ago');
    expect(relativeTime('2026-07-01T11:30:00.000Z', now)).toBe('2h ago');
  });
});

describe('ContentHistoryPanel', () => {
  it('REVERT-PROOF: opening the panel issues no snapshot request until a version is selected', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes(`/projects/${projectId}/revisions`)) {
        return jsonResponse([revisionB, revisionA]);
      }
      if (isSnapshotGet(url) || url.includes('/diff?')) {
        return jsonResponse(snapshotB);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeTruthy();
      expect(screen.getByText('alice')).toBeTruthy();
    });

    const snapshotCalls = fetchMock.mock.calls.filter((call) => isSnapshotGet(requestUrl(call[0])));
    expect(snapshotCalls).toHaveLength(0);

    fireEvent.click(screen.getByText('bob'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => isSnapshotGet(requestUrl(call[0])))).toBe(true);
    });
  });

  it('REVERT-PROOF: confirmation copy names fields and uses content history; revert appears nowhere', async () => {
    mockFetch((url) => {
      if (url.includes('/revisions?')) {
        return jsonResponse([revisionB, revisionA]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeTruthy();
    });

    // Sheet content is portaled to document.body.
    const panelText = document.body.textContent;
    expect(panelText.toLowerCase()).toContain('content history');
    expect(panelText.toLowerCase()).not.toContain('revert');

    const restoreButtons = screen.getAllByRole('button', { name: 'Restore' });
    const firstRestore = restoreButtons[0];
    expect(firstRestore).toBeTruthy();
    if (firstRestore === undefined) {
      throw new Error('expected a Restore button');
    }
    fireEvent.click(firstRestore);

    expect(await screen.findByText('Restore from content history?')).toBeTruthy();
    const confirmCopy = screen.getByText(/Restore this version from content history/);
    const confirmText = confirmCopy.textContent;
    expect(confirmText).toContain('label');
    expect(confirmText).toContain('description');
    expect(confirmText.toLowerCase()).not.toContain('revert');
  });

  it('lists two versions with authors and relative times', async () => {
    const now = Date.parse('2026-07-01T14:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    mockFetch((url) => {
      if (url.includes('/revisions?')) {
        return jsonResponse([revisionB, revisionA]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeTruthy();
      expect(screen.getByText('alice')).toBeTruthy();
    });
    expect(screen.getByText(/1h ago/)).toBeTruthy();
    expect(screen.getByText(/2h ago/)).toBeTruthy();
  });

  it('selecting one renders content; selecting a second renders a diff', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/revisions?')) {
        return jsonResponse([revisionB, revisionA]);
      }
      if (url === '/api/v1/revisions/rev-b') {
        return jsonResponse(snapshotB);
      }
      if (url === '/api/v1/revisions/rev-a') {
        return jsonResponse(snapshotA);
      }
      if (url.startsWith('/api/v1/revisions/rev-b/diff')) {
        return jsonResponse(sampleDiff);
      }
      if (url.startsWith('/api/v1/revisions/rev-a/diff')) {
        return jsonResponse(sampleDiff);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('bob'));

    await waitFor(() => {
      expect(screen.getByLabelText('Version content')).toBeTruthy();
      expect(screen.getByText('second draft')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('alice'));

    await waitFor(() => {
      expect(screen.queryByLabelText('Version content')).toBeNull();
      expect(screen.getByLabelText('Content diff')).toBeTruthy();
      expect(screen.getByText(/Diff between versions/)).toBeTruthy();
      expect(screen.getByText(/\+second draft/)).toBeTruthy();
    });

    const againstCalls = fetchMock.mock.calls
      .map((call) => requestUrl(call[0]))
      .filter((url) => url.includes('/diff?'));
    expect(
      againstCalls.some((url) => url.includes('against=rev-b') || url.includes('against=rev-a')),
    ).toBe(true);
  });

  it('restoring updates the live entity and adds a new version without a reload', async () => {
    let listPayload: SerializedRevisionMeta[] = [revisionB, revisionA];
    const onRestored = vi.fn();
    mockFetch((url, init) => {
      if (url.includes('/revisions?')) {
        return jsonResponse(listPayload);
      }
      if (url === '/api/v1/revisions/rev-a/restore' && init?.method === 'POST') {
        listPayload = [
          {
            id: 'rev-c',
            author: 'human:carol',
            changed_fields: ['description'],
            created_at: '2026-07-01T14:00:00.000Z',
          },
          revisionB,
          revisionA,
        ];
        return jsonResponse(restoredTask);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderPanel({ onRestored });

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });

    const aliceRow = screen.getByText('alice').closest('li');
    expect(aliceRow).toBeTruthy();
    if (aliceRow === null) {
      throw new Error('expected alice row');
    }
    fireEvent.click(within(aliceRow).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Restore from content history?')).toBeTruthy();
    const confirm = screen.getByText('Restore from content history?').closest('[role="dialog"]');
    expect(confirm).toBeTruthy();
    if (!(confirm instanceof HTMLElement)) {
      throw new Error('expected confirm dialog');
    }
    fireEvent.click(within(confirm).getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledWith(restoredTask);
      expect(screen.getByText('carol')).toBeTruthy();
    });
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('shows an empty state — not a spinner or an error — when there is no history', async () => {
    mockFetch((url) => {
      if (url.includes('/revisions?')) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderPanel();

    const empty = await screen.findByTestId('content-history-empty');
    expect(empty.textContent).toContain('No content history yet');
    expect(empty.textContent).toContain('Deleting the record removes its history permanently');
    expect(screen.queryByText(/Loading content history/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('document restore confirmation names title, body, and status line', async () => {
    mockFetch((url) => {
      if (url.includes('/revisions?')) {
        return jsonResponse([
          {
            id: 'rev-doc',
            author: 'human:ada',
            changed_fields: ['body'],
            created_at: '2026-07-01T12:00:00.000Z',
          },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ContentHistoryPanel
          projectId={projectId}
          targetType="document"
          targetId="doc-1"
          open
          onOpenChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('ada')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Restore from content history?')).toBeTruthy();
    const confirmCopy = screen.getByText(/Restore this version from content history/);
    const confirmText = confirmCopy.textContent;
    expect(confirmText).toContain('title');
    expect(confirmText).toContain('body');
    expect(confirmText).toContain('status line');
    expect(confirmText.toLowerCase()).not.toContain('revert');
  });
});
