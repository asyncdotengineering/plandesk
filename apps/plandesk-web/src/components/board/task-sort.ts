import { SORTABLE_FIELDS, type SortableField, type SortSpec } from '@plandesk/db/saved-view-config';

export type { SortableField, SortSpec };
export { SORTABLE_FIELDS };
export { sortTasks } from '@plandesk/db/view-eval';

export const SORTABLE_FIELD_LABELS: Record<SortableField, string> = {
  label: 'Label',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  due_date: 'Due date',
  created_at: 'Created',
  updated_at: 'Updated',
};
