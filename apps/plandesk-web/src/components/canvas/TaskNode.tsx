import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useState, type MouseEvent } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusMenu } from '../board/StatusChip.js';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '../../lib/api.js';
import type { TaskNodeData } from './canvas-map.js';
import { OpenDocLink } from './OpenDocLink.js';

type TaskNodeCallbacks = {
  onPatchLabel: (taskId: string, label: string) => void;
  onPatchStatus: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
};

let taskNodeCallbacks: TaskNodeCallbacks | null = null;

export function registerTaskNodeCallbacks(callbacks: TaskNodeCallbacks | null) {
  taskNodeCallbacks = callbacks;
}

export function TaskNode({ id, data, selected }: NodeProps<Node<TaskNodeData>>) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(data.label);

  useEffect(() => {
    setLabelDraft(data.label);
  }, [data.label]);

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed === '' || trimmed === data.label) {
      setLabelDraft(data.label);
      setEditing(false);
      return;
    }
    taskNodeCallbacks?.onPatchLabel(id, trimmed);
    setEditing(false);
  };

  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    if (confirm('Delete this task? Connected edges will be removed.')) {
      taskNodeCallbacks?.onDelete(id);
    }
  };

  return (
    <div
      className={cn(
        'group relative w-[212px] cursor-grab rounded-lg border border-border bg-card p-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]',
        selected && 'border-foreground shadow-[0_0_0_1px_var(--foreground)]',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--border-strong)]" />
      <div className="mb-2 flex items-start gap-1">
        {editing ? (
          <input
            className="nodrag flex-1 rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-[12.5px] font-semibold leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="text"
            value={labelDraft}
            autoFocus
            onChange={(event) => {
              setLabelDraft(event.target.value);
            }}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitLabel();
              }
              if (event.key === 'Escape') {
                setLabelDraft(data.label);
                setEditing(false);
              }
            }}
            aria-label="Task label"
          />
        ) : (
          <button
            // Deliberately NOT `nodrag`. The title spans the node, and `nodrag`
            // filters the drag out at d3-drag's filter, which left only the
            // ~10px padding ring grabbable — fine for a mouse, unhittable by
            // finger. `nodeDragThreshold` on the canvas separates the tap that
            // renames from the drag that moves.
            className="flex-1 text-left text-[12.5px] font-semibold leading-snug"
            type="button"
            onClick={() => {
              setEditing(true);
            }}
            title="Edit label"
          >
            {data.label}
          </button>
        )}
        <Button
          className="nodrag -mr-1 -mt-1 size-5 text-muted-foreground hover:text-destructive"
          variant="ghost"
          size="icon-xs"
          type="button"
          onClick={handleDelete}
          aria-label="Delete task"
          title="Delete task"
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="nodrag">
          <StatusMenu
            status={data.status}
            onChange={(status) => {
              taskNodeCallbacks?.onPatchStatus(id, status);
            }}
          />
        </span>
        {data.documentId !== undefined ? (
          <span className="nodrag ml-auto">
            <OpenDocLink projectId={data.projectId} documentId={data.documentId} />
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--border-strong)]" />
    </div>
  );
}
