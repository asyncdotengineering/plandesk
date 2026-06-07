import { useAgentRuns } from '../../lib/queries.js';

type AgentRunsPanelProps = {
  projectId: string;
};

const statusColors: Record<string, string> = {
  running: '#1d4ed8',
  completed: '#15803d',
  failed: '#b91c1c',
};

function formatStatus(status: string): string {
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'completed') {
    return 'Completed';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  return status;
}

export function AgentRunsPanel({ projectId }: AgentRunsPanelProps) {
  const { data: runs, isLoading, error } = useAgentRuns(projectId);

  return (
    <aside
      aria-label="Agents activity"
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 10,
        width: 280,
        maxHeight: 'calc(100% - 1rem)',
        overflow: 'auto',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        padding: '0.75rem',
      }}
    >
      <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>
        Agents activity
      </h2>
      {isLoading ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6b7280' }}>Loading…</p>
      ) : null}
      {error !== null ? (
        <p role="alert" style={{ margin: 0, fontSize: '0.8125rem', color: '#b91c1c' }}>
          Failed to load agent runs
        </p>
      ) : null}
      {!isLoading && error === null && runs !== undefined && runs.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6b7280' }}>No agent runs yet.</p>
      ) : null}
      {runs?.map((run) => (
        <article
          key={run.id}
          style={{
            borderTop: '1px solid #f3f4f6',
            paddingTop: '0.625rem',
            marginTop: '0.625rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <strong style={{ fontSize: '0.8125rem' }}>{run.label ?? 'Agent run'}</strong>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: statusColors[run.status] ?? '#374151',
                textTransform: 'uppercase',
              }}
            >
              {formatStatus(run.status)}
            </span>
          </div>
          {run.events.length > 0 ? (
            <ul
              style={{
                margin: '0.375rem 0 0',
                paddingLeft: '1rem',
                fontSize: '0.75rem',
                color: '#4b5563',
              }}
            >
              {run.events.map((event) => (
                <li key={event.id}>{event.message}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </aside>
  );
}
