import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandMenu, CommandMenuProvider, NAV_ITEMS } from './CommandMenu.js';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'proj-1' }),
}));
vi.mock('../../lib/auth.js', () => ({ useActiveWorkspace: () => ({ id: 'ws-1' }) }));
vi.mock('../../lib/queries.js', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('../../lib/api.js', () => ({
  searchWorkspace: vi.fn(() =>
    Promise.resolve({
      // A body-only match: its title does not contain the query.
      documents: [
        {
          id: 'doc-1',
          project_id: 'proj-1',
          title: 'Field notes',
          matched: 'body',
          excerpt: '…we saw a quokka near the trail…',
        },
      ],
      tasks: [],
      notes: [],
    }),
  ),
}));

// jsdom lacks the layout APIs cmdk and the dialog use.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
});

describe('CommandMenu', () => {
  it('includes Documents in the Navigate group', () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    expect(labels).toContain('Documents');
  });

  it('shows a server body match while still narrowing the static commands', async () => {
    render(
      <CommandMenuProvider>
        <CommandMenu />
      </CommandMenuProvider>,
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
    });
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'quokka' } });

    // The server matched it on the body; the client must not filter it away.
    expect(await screen.findByText('Field notes')).toBeTruthy();
    expect(screen.getByText('…we saw a quokka near the trail…')).toBeTruthy();
    // Navigation commands are still filtered by what was typed.
    await waitFor(() => {
      expect(screen.queryByText('Board')).toBeNull();
    });
  });
});
