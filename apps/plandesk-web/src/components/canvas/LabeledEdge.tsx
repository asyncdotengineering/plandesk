import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { edgeLabels, type EdgeLabel } from '../../lib/api.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LabeledEdgeData } from './canvas-map.js';

const edgeLabelFriendly: Record<EdgeLabel, string> = {
  blocks: 'blocks',
  depends_on: 'depends on',
  unblocks: 'unblocks',
  feeds: 'feeds into',
  clarifies: 'clarifies',
  enables: 'enables',
  supports: 'supports',
  relates: 'relates to',
};

export function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<LabeledEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const [editing, setEditing] = useState(false);
  const label = data?.label ?? 'depends_on';
  const canEdit = data?.onLabelChange !== undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: 'var(--border-strong)', strokeWidth: 1.5 }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${String(labelX)}px,${String(labelY)}px)`,
            pointerEvents: 'all',
          }}
        >
          {editing && canEdit ? (
            <Select
              value={label}
              onValueChange={(value) => {
                data.onLabelChange?.(value as EdgeLabel);
                setEditing(false);
              }}
              open
              onOpenChange={(open) => {
                if (!open) {
                  setEditing(false);
                }
              }}
            >
              <SelectTrigger className="h-auto w-auto border-border bg-card px-2 py-0.5 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {edgeLabels.map((option) => (
                  <SelectItem key={option} value={option} className="text-xs">
                    {edgeLabelFriendly[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <button
              type="button"
              className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              onClick={() => {
                if (canEdit) {
                  setEditing(true);
                }
              }}
            >
              {edgeLabelFriendly[label]}
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
