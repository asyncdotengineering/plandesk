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
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${String(labelX)}px,${String(labelY)}px)`,
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '0.125rem 0.375rem',
            borderRadius: 4,
            background: '#f3f4f6',
            color: '#374151',
            border: '1px solid #d1d5db',
            pointerEvents: 'all',
          }}
        >
          {data?.label ?? 'depends_on'}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
