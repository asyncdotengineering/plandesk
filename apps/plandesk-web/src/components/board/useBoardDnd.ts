import { type DragEndEvent } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { type SerializedTask, type TaskStatus } from '../../lib/api.js';
import { queryKeys, usePatchTask } from '../../lib/queries.js';
import { resolveDropStatus } from './board-utils.js';

type UseBoardDndOptions = {
  projectId: string;
  tasks: SerializedTask[];
};

export function useBoardDnd({ projectId, tasks }: UseBoardDndOptions) {
  const queryClient = useQueryClient();
  const patchTask = usePatchTask();

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over === null) {
        return;
      }

      const taskId = String(active.id);
      const task = tasksById.get(taskId);
      if (task === undefined) {
        return;
      }

      const newStatus = resolveDropStatus(over.id, tasksById);
      if (newStatus === undefined || newStatus === task.status) {
        return;
      }

      const previousTasks = queryClient.getQueryData<SerializedTask[]>(queryKeys.tasks(projectId));

      queryClient.setQueryData<SerializedTask[]>(queryKeys.tasks(projectId), (current) =>
        current?.map((item) => (item.id === taskId ? { ...item, status: newStatus } : item)),
      );

      queryClient.setQueryData(queryKeys.canvas(projectId), (current) => {
        if (current === undefined || typeof current !== 'object' || current === null) {
          return current;
        }
        const canvas = current as { nodes: SerializedTask[]; edges: unknown; layout: unknown };
        return {
          ...canvas,
          nodes: canvas.nodes.map((node) =>
            node.id === taskId ? { ...node, status: newStatus } : node,
          ),
        };
      });

      patchTask.mutate(
        { id: taskId, input: { status: newStatus } },
        {
          onError: () => {
            if (previousTasks !== undefined) {
              queryClient.setQueryData(queryKeys.tasks(projectId), previousTasks);
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.canvas(projectId) });
          },
        },
      );
    },
    [patchTask, projectId, queryClient, tasksById],
  );

  return { handleDragEnd, isUpdating: patchTask.isPending, updateError: patchTask.error };
}

export function statusFromDragEnd(
  event: Pick<DragEndEvent, 'active' | 'over'>,
  tasks: SerializedTask[],
): { taskId: string; status: TaskStatus } | null {
  if (event.over === null) {
    return null;
  }
  const taskId = String(event.active.id);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const task = tasksById.get(taskId);
  if (task === undefined) {
    return null;
  }
  const newStatus = resolveDropStatus(event.over.id, tasksById);
  if (newStatus === undefined || newStatus === task.status) {
    return null;
  }
  return { taskId, status: newStatus };
}
