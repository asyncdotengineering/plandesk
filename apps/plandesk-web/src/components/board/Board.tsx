import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import type { SerializedTask } from '../../lib/api.js';
import { BoardColumn } from './BoardColumn.js';
import { boardColumnOrder, groupTasksByStatus } from './board-utils.js';
import { TaskCard } from './TaskCard.js';
import { useBoardDnd } from './useBoardDnd.js';

type BoardProps = {
  projectId: string;
  tasks: SerializedTask[];
};

export function Board({ projectId, tasks }: BoardProps) {
  const grouped = useMemo(() => groupTasksByStatus(tasks), [tasks]);
  const { handleDragEnd, isUpdating, updateError } = useBoardDnd({ projectId, tasks });
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const activeTask =
    activeTaskId !== null ? tasks.find((task) => task.id === activeTaskId) : undefined;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragEndWrapped = (event: Parameters<typeof handleDragEnd>[0]) => {
    handleDragEnd(event);
    setActiveTaskId(null);
  };

  return (
    <div>
      {isUpdating ? (
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: 0 }}>Updating task…</p>
      ) : null}
      {updateError !== null ? (
        <p role="alert" style={{ color: '#b91c1c', marginTop: 0 }}>
          Failed to update task: {updateError.message}
        </p>
      ) : null}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEndWrapped}>
        <div
          style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', overflowX: 'auto' }}
        >
          {boardColumnOrder.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={grouped[status]}
              activeTaskId={activeTaskId}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask !== undefined ? <TaskCard task={activeTask} isDragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
