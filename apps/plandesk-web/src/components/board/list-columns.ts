export const LIST_COLUMNS = [
  'label',
  'status',
  'goal',
  'assignee',
  'tags',
  'blocked',
  'due_date',
  'updated_at',
] as const;

export type ListColumnId = (typeof LIST_COLUMNS)[number];

export const LIST_COLUMN_LABELS: Record<ListColumnId, string> = {
  label: 'Label',
  status: 'Status',
  goal: 'Goal',
  assignee: 'Assignee',
  tags: 'Tags',
  blocked: 'Blocked',
  due_date: 'Due date',
  updated_at: 'Updated',
};

export function formatListDate(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
