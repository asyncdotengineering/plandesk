import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useNavigate } from '@tanstack/react-router';

export type BoundaryMarkerData = {
  direction: 'exit' | 'arrive';
  foreignTitle: string;
  foreignPrototypeId: string;
  foreignPrototypeName: string;
  foreignArtifactId: string;
  projectId: string;
  [key: string]: unknown;
};

/**
 * Cross-prototype link marker. Following it switches the canvas view —
 * markup is never rewritten; the derived link still resolves at runtime.
 */
export function BoundaryMarkerNode({ data }: NodeProps<Node<BoundaryMarkerData>>) {
  const navigate = useNavigate();
  const label =
    data.direction === 'exit'
      ? `exits to ${data.foreignPrototypeName}`
      : `arrives from ${data.foreignPrototypeName}`;

  return (
    <div
      data-boundary-marker
      data-boundary-direction={data.direction}
      className="flex w-[200px] flex-col gap-1 rounded-md border border-dashed border-border bg-card px-3 py-2 text-xs shadow-sm"
    >
      {data.direction === 'exit' ? (
        <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      ) : (
        <Handle type="source" position={Position.Left} className="!bg-muted-foreground" />
      )}
      <span className="font-medium text-muted-foreground">{label}</span>
      <button
        type="button"
        className="truncate text-left font-semibold text-foreground underline-offset-2 hover:underline"
        onClick={() => {
          void navigate({
            to: '/projects/$id/prototypes/$prototypeId',
            params: { id: data.projectId, prototypeId: data.foreignPrototypeId },
          });
        }}
      >
        {data.foreignTitle}
      </button>
    </div>
  );
}
