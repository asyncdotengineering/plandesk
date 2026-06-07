import { useCallback, useEffect, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { usePutCanvas } from '../../lib/queries.js';
import { buildLayoutPayload, type LabeledEdgeData, type TaskNodeData } from './canvas-map.js';

const SAVE_DEBOUNCE_MS = 400;

export function useCanvasSync(projectId: string) {
  const putCanvas = usePutCanvas(projectId);
  const nodesRef = useRef<Node<TaskNodeData>[]>([]);
  const edgesRef = useRef<Edge<LabeledEdgeData>[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveLayoutNow = useCallback(() => {
    putCanvas.mutate(buildLayoutPayload(nodesRef.current, edgesRef.current));
  }, [putCanvas]);

  const scheduleLayoutSave = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveLayoutNow();
    }, SAVE_DEBOUNCE_MS);
  }, [saveLayoutNow]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  const bindFlowState = useCallback(
    (nodes: Node<TaskNodeData>[], edges: Edge<LabeledEdgeData>[]) => {
      nodesRef.current = nodes;
      edgesRef.current = edges;
    },
    [],
  );

  const onNodeDragStop = useCallback(() => {
    scheduleLayoutSave();
  }, [scheduleLayoutSave]);

  const saveWithState = useCallback(
    (nodes: Node<TaskNodeData>[], edges: Edge<LabeledEdgeData>[]) => {
      nodesRef.current = nodes;
      edgesRef.current = edges;
      clearTimeout(timerRef.current);
      saveLayoutNow();
    },
    [saveLayoutNow],
  );

  return {
    bindFlowState,
    onNodeDragStop,
    saveWithState,
    isSaving: putCanvas.isPending,
    saveError: putCanvas.error,
  };
}
