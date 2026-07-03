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
import { useCreateTask, useDeleteTask, usePatchTask, useTags } from '../../lib/queries.js';
import { TaskDetail } from '../canvas/TaskDetail.js';
import { BoardColumn } from './BoardColumn.js';
import { boardColumnOrder, filterTasksByAnyTag, groupTasksByStatus } from './board-utils.js';
import { TaskCard } from './TaskCard.js';
import { useBoardDnd } from './useBoardDnd.js';

type BoardProps = {
  projectId: string;
  tasks: SerializedTask[];
};

export function Board({ projectId, tasks }: BoardProps) {
  const { data: projectTags } = useTags(projectId);
  // OR semantics: a task stays visible when it carries ANY selected tag.
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const visibleTasks = useMemo(
    () => filterTasksByAnyTag(tasks, selectedTagIds),
    [tasks, selectedTagIds],
  );
  const grouped = useMemo(() => groupTasksByStatus(visibleTasks), [visibleTasks]);
  const { handleDragEnd, isUpdating, updateError } = useBoardDnd({ projectId, tasks });
  const createTask = useCreateTask(projectId);
  const patchTask = usePatchTask();
  const deleteTask = useDeleteTask();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const toggleTagFilter = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

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

  // Add/remove send the FULL replacement tag-name set (server replace semantics).
  const handleAddTag = (name: string) => {
    if (selectedTask === undefined) {
      return;
    }
    const names = (selectedTask.tags ?? []).map((tag) => tag.name);
    if (names.includes(name)) {
      return;
    }
    patchTask.mutate({ id: selectedTask.id, input: { tags: [...names, name] } });
  };

  const handleRemoveTag = (name: string) => {
    if (selectedTask === undefined) {
      return;
    }
    const names = (selectedTask.tags ?? []).map((tag) => tag.name).filter((n) => n !== name);
    patchTask.mutate({ id: selectedTask.id, input: { tags: names } });
  };

  return (
    <div style={{ position: 'relative' }}>
      {projectTags !== undefined && projectTags.length > 0 ? (
        <div
          role="group"
          aria-label="Filter by tag"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.375rem',
            marginBottom: '0.75rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Filter:</span>
          {projectTags.map((tag) => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  toggleTagFilter(tag.id);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: selected ? '#1d4ed8' : '#374151',
                  background: selected ? '#eff6ff' : '#f3f4f6',
                  border: selected ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                  borderRadius: 999,
                  padding: '0.125rem 0.625rem',
                  cursor: 'pointer',
                }}
              >
                {tag.color !== null ? (
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: tag.color,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                {tag.name}
              </button>
            );
          })}
          {selectedTagIds.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSelectedTagIds([]);
              }}
              style={{
                border: 'none',
                background: 'none',
                color: '#6b7280',
                fontSize: '0.75rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : null}
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
          tags={selectedTask.tags ?? []}
          tagSuggestions={(projectTags ?? []).map((tag) => tag.name)}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
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
