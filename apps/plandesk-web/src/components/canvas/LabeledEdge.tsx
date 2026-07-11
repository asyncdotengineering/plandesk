import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { LabeledEdgeData } from './canvas-map.js';

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

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: 'var(--border-strong)', strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${String(labelX)}px,${String(labelY)}px)`,
            pointerEvents: 'all',
          }}
        >
          {data?.label ?? 'depends_on'}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
