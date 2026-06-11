import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import type { SerializedTask, TaskStatus } from '../../lib/api.js';
import { useCreateTask, useDeleteTask, usePatchTask } from '../../lib/queries.js';
import { TaskDetail } from '../canvas/TaskDetail.js';
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
  const createTask = useCreateTask(projectId);
  const patchTask = usePatchTask();
  const deleteTask = useDeleteTask();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const activeTask =
    activeTaskId !== null ? tasks.find((task) => task.id === activeTaskId) : undefined;
  const selectedTask =
    selectedTaskId !== null ? tasks.find((task) => task.id === selectedTaskId) : undefined;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragEndWrapped = (event: Parameters<typeof handleDragEnd>[0]) => {
    handleDragEnd(event);
    setActiveTaskId(null);
  };

  const handleAddTask = (status: TaskStatus, label: string) => {
    createTask.mutate({ label, status });
  };

  const handleDeleteTask = (taskId: string) => {
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
    deleteTask.mutate({ id: taskId, projectId });
  };

  return (
    <div style={{ position: 'relative' }}>
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
              onAddTask={handleAddTask}
              onOpenTask={setSelectedTaskId}
              onDeleteTask={handleDeleteTask}
              isAdding={createTask.isPending}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask !== undefined ? (
            <TaskCard
              task={activeTask}
              isDragging
              onOpen={() => undefined}
              onDelete={handleDeleteTask}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {selectedTask !== undefined ? (
        <TaskDetail
          taskId={selectedTask.id}
          data={{
            label: selectedTask.label,
            status: selectedTask.status,
            projectId,
            description: selectedTask.description,
            assignee: selectedTask.assignee,
            dueDate: selectedTask.due_date,
          }}
          isSaving={patchTask.isPending}
          onPatch={(input) => {
            patchTask.mutate({ id: selectedTask.id, input });
          }}
          onDelete={() => {
            deleteTask.mutate(
              { id: selectedTask.id, projectId },
              {
                onSuccess: () => {
                  setSelectedTaskId(null);
                },
              },
            );
          }}
          onClose={() => {
            setSelectedTaskId(null);
          }}
        />
      ) : null}
    </div>
  );
}
