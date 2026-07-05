import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSseInvalidation } from './events.js';
import { queryKeys } from './queries.js';

const eventSources: MockEventSource[] = [];

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor() {
    eventSources.push(this);
  }

  close(): void {}
}

function dispatchSse(data: unknown) {
  const source = eventSources[eventSources.length - 1];
  source?.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
}

describe('useSseInvalidation task_updated', () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates tasks and canvas queries on task_updated', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        useSseInvalidation();
      },
      { wrapper },
    );

    dispatchSse({
      type: 'task_updated',
      taskId: 'task-1',
      projectId: 'proj-1',
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('proj-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('proj-1') });
  });
});

describe('useSseInvalidation comment events', () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates documentComments query on comment_created', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        useSseInvalidation();
      },
      { wrapper },
    );

    dispatchSse({
      type: 'comment_created',
      commentId: 'cmt-1',
      documentId: 'doc-1',
      projectId: 'proj-1',
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.documentComments('doc-1'),
    });
  });

  it('invalidates documentComments query on comment_updated', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        useSseInvalidation();
      },
      { wrapper },
    );

    dispatchSse({
      type: 'comment_updated',
      commentId: 'cmt-1',
      documentId: 'doc-1',
      projectId: 'proj-1',
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.documentComments('doc-1'),
    });
  });
});

describe('useSseInvalidation goal_updated', () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates goals, goal detail, tasks, and canvas on goal_updated', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        useSseInvalidation();
      },
      { wrapper },
    );

    dispatchSse({
      type: 'goal_updated',
      goalId: 'goal-1',
      projectId: 'proj-1',
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goals('proj-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.goal('goal-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('proj-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('proj-1') });
  });
});

describe('useSseInvalidation agent_run events', () => {
  beforeEach(() => {
    eventSources.length = 0;
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates agentRuns query on agent_run_progress', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    renderHook(
      () => {
        useSseInvalidation();
      },
      { wrapper },
    );

    dispatchSse({
      type: 'agent_run_progress',
      runId: 'run-1',
      projectId: 'proj-1',
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.agentRuns('proj-1') });
  });
});
