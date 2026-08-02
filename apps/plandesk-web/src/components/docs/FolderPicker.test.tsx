import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerializedFolder } from '../../lib/api.js';
import { FolderPicker, folderNestingPath } from './FolderPicker.js';

const projectId = 'proj-1';

function makeFolder(id: string, name: string, parentFolderId: string | null): SerializedFolder {
  return {
    id,
    project_id: projectId,
    name,
    parent_folder_id: parentFolderId,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
});

describe('folderNestingPath', () => {
  it('joins ancestor names with slashes', () => {
    const folders = [
      makeFolder('f1', 'Specs', null),
      makeFolder('f2', 'Archive', 'f1'),
      makeFolder('f3', '2024', 'f2'),
    ];
    expect(folderNestingPath(folders, 'f3')).toBe('Specs / Archive / 2024');
  });
});

describe('FolderPicker', () => {
  it('filters folders by typed text and shows nesting paths', () => {
    const folders = [
      makeFolder('f1', 'Specs', null),
      makeFolder('f2', 'Archive', 'f1'),
      makeFolder('f3', 'Notes', null),
    ];
    const onChange = vi.fn();
    render(<FolderPicker folders={folders} value={null} onChange={onChange} />);

    expect(screen.getByRole('option', { name: 'Specs / Archive' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Notes' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter folders'), {
      target: { value: 'arch' },
    });
    expect(screen.getByRole('option', { name: 'Specs / Archive' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Notes' })).toBeNull();
  });

  it('selecting a folder calls onChange with its id', () => {
    const folders = [makeFolder('f1', 'Specs', null)];
    const onChange = vi.fn();
    render(<FolderPicker folders={folders} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Destination'), {
      target: { value: 'f1' },
    });
    expect(onChange).toHaveBeenCalledWith('f1');
  });
});
