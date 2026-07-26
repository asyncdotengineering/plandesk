import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from '../../test-utils.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';

const session = {
  kind: 'loopback' as const,
  user_ref: null,
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Personal' },
  orgs: [{ id: 'org-1', name: 'Personal', role: 'owner' }],
  active_workspace: { id: 'ws-1', name: 'General' },
  workspaces: [
    { id: 'ws-1', name: 'General' },
    { id: 'ws-2', name: 'Fiji TV' },
  ],
};

const project = (id: string, name: string, workspaceId: string) => ({
  id,
  name,
  description: null,
  workspace_id: workspaceId,
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
});

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => body, text: () => '' };
}

function stubProjects(projects: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/session')) return ok(session);
      if (url.endsWith('/projects')) return ok(projects);
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
    }),
  );
}

function renderSwitcher(props: { activeProjectId?: string; onNavigate: (id: string) => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSwitcher {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar project switcher (REQ-3)', () => {
  it("lists the active workspace's projects and navigates on select", async () => {
    const onNavigate = vi.fn();
    stubProjects([
      project('p1', 'Alpha', 'ws-1'),
      project('p2', 'Beta', 'ws-1'),
      project('p3', 'Other Workspace', 'ws-2'),
    ]);

    renderSwitcher({ onNavigate });

    // Trigger reads "Projects" while no active project is set.
    const trigger = await screen.findByRole('button', { name: /switch project$/i });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const beta = await screen.findByText('Beta');
    fireEvent.click(beta);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('p2');
    });

    // The other workspace's project is filtered out client-side.
    expect(screen.queryByText('Other Workspace')).toBeNull();
  });

  it('shows the active project as the trigger label and marks it current', async () => {
    const onNavigate = vi.fn();
    stubProjects([project('p1', 'Alpha', 'ws-1'), project('p2', 'Beta', 'ws-1')]);

    renderSwitcher({ activeProjectId: 'p1', onNavigate });

    // The active project name surfaces as the trigger label.
    await screen.findByRole('button', { name: /switch project \(current: alpha\)/i });

    fireEvent.keyDown(screen.getByRole('button', { name: /switch project/i }), { key: 'Enter' });

    // The current project is rendered as a disabled menuitem; the other is selectable.
    const items = await screen.findAllByRole('menuitem');
    const alpha = items.find((el) => el.textContent.includes('Alpha'));
    expect(alpha).toBeTruthy();
    expect(alpha?.getAttribute('aria-disabled')).toBe('true');

    // Disabled current item does not navigate.
    fireEvent.click(alpha as HTMLElement);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows an empty state when the active workspace has no projects', async () => {
    const onNavigate = vi.fn();
    stubProjects([project('p3', 'Other Workspace', 'ws-2')]);

    renderSwitcher({ onNavigate });

    const trigger = await screen.findByRole('button', { name: /switch project$/i });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(await screen.findByText(/no projects yet/i)).toBeTruthy();
    expect(screen.queryByText('Other Workspace')).toBeNull();
  });
});
