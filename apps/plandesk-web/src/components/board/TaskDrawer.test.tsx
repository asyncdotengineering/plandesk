import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerializedTask } from '../../lib/api.js';
import { TaskDrawer } from './TaskDrawer.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={props.to} className={props.className} onClick={props.onClick}>
      {children}
    </a>
  ),
}));

vi.mock('../../lib/queries.js', () => ({
  useDocuments: () => ({ data: [] }),
}));

vi.mock('../docs/CommentsPanel.js', () => ({
  CommentsPanel: () => null,
}));

vi.mock('../editor/RichTextEditor.js', () => ({
  RichTextEditor: () => null,
}));

vi.mock('@/components/share/ShareButton', () => ({
  ShareButton: () => null,
}));

const baseTask: SerializedTask = {
  id: '00000000-0000-4000-8000-000000000001',
  project_id: 'proj-1',
  goal_id: 'goal-1',
  label: 'Ship commit refs',
  status: 'done',
  description: null,
  x: 0,
  y: 0,
  assignee: null,
  due_date: null,
  commit_refs: ['abc1234def'],
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
  tags: [],
};

afterEach(() => {
  cleanup();
});

describe('TaskDrawer commit refs', () => {
  it('renders a github commit link when repoUrl is a known host', () => {
    render(
      <TaskDrawer
        task={{ ...baseTask }}
        repoUrl="https://github.com/org/repo"
        tagSuggestions={[]}
        open
        onOpenChange={() => undefined}
        onPatch={() => undefined}
        onChangeStatus={() => undefined}
        onAddTag={() => undefined}
        onRemoveTag={() => undefined}
      />,
    );

    const link = screen.getByRole('link', { name: 'abc1234' });
    expect(link.getAttribute('href')).toBe('https://github.com/org/repo/commit/abc1234def');
  });

  it('renders plain text for an unknown host', () => {
    render(
      <TaskDrawer
        task={{ ...baseTask }}
        repoUrl="https://git.example.com/repo"
        tagSuggestions={[]}
        open
        onOpenChange={() => undefined}
        onPatch={() => undefined}
        onChangeStatus={() => undefined}
        onAddTag={() => undefined}
        onRemoveTag={() => undefined}
      />,
    );

    expect(screen.queryByRole('link', { name: 'abc1234' })).toBeNull();
    expect(screen.getByText('abc1234def')).toBeTruthy();
  });

  it('renders plain text when repoUrl is missing', () => {
    render(
      <TaskDrawer
        task={{ ...baseTask }}
        repoUrl={null}
        tagSuggestions={[]}
        open
        onOpenChange={() => undefined}
        onPatch={() => undefined}
        onChangeStatus={() => undefined}
        onAddTag={() => undefined}
        onRemoveTag={() => undefined}
      />,
    );

    expect(screen.queryByRole('link', { name: 'abc1234' })).toBeNull();
    expect(screen.getByText('abc1234def')).toBeTruthy();
  });

  it('links scp-style github remotes the same as https', () => {
    render(
      <TaskDrawer
        task={{ ...baseTask }}
        repoUrl="git@github.com:org/repo.git"
        tagSuggestions={[]}
        open
        onOpenChange={() => undefined}
        onPatch={() => undefined}
        onChangeStatus={() => undefined}
        onAddTag={() => undefined}
        onRemoveTag={() => undefined}
      />,
    );

    expect(screen.getByRole('link', { name: 'abc1234' }).getAttribute('href')).toBe(
      'https://github.com/org/repo/commit/abc1234def',
    );
  });
});
