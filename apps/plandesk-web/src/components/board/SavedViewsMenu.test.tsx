import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVED_VIEW_CONFIG_VERSION } from '@plandesk/db/saved-view-config';
import type { SerializedView } from '../../lib/api.js';
import { SavedViewsMenu } from './SavedViewsMenu.js';

const viewA: SerializedView = {
  id: 'view-a',
  project_id: 'proj-1',
  name: 'Alpha',
  config: {
    version: SAVED_VIEW_CONFIG_VERSION,
    filter: null,
    sort: [{ field: 'status', direction: 'asc' }],
    group: null,
    visibleColumns: ['label', 'status'],
  },
  position: 0,
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
});

describe('SavedViewsMenu', () => {
  it('lists views, selects one, saves, renames, and deletes', () => {
    const onSelect = vi.fn();
    const onSave = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();

    render(
      <SavedViewsMenu
        views={[viewA]}
        activeViewId="view-a"
        onSelect={onSelect}
        onSave={onSave}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(onSelect).toHaveBeenCalledWith(viewA);

    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    fireEvent.change(screen.getByLabelText('New view name'), { target: { value: 'Beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
    expect(onSave).toHaveBeenCalledWith('Beta');

    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    fireEvent.change(screen.getByLabelText('Rename view Alpha'), { target: { value: 'Alpha 2' } });
    fireEvent.click(screen.getByLabelText('Confirm rename'));
    expect(onRename).toHaveBeenCalledWith('view-a', 'Alpha 2');

    fireEvent.click(screen.getByLabelText('Delete Alpha'));
    expect(onDelete).toHaveBeenCalledWith('view-a');
  });
});
