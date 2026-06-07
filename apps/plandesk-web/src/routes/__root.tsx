import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { useSseInvalidation } from '../lib/events.js';

function RootLayout() {
  useSseInvalidation();

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          padding: '0.75rem 1.5rem',
          borderBottom: '1px solid #e5e5e5',
        }}
      >
        <Link to="/" style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>
          Plan Desk
        </Link>
        <nav style={{ display: 'flex', gap: '1rem', marginLeft: 'auto' }}>
          <Link to="/" style={{ color: '#555', textDecoration: 'none' }}>
            Projects
          </Link>
          <Link to="/settings/mcp" style={{ color: '#555', textDecoration: 'none' }}>
            MCP Settings
          </Link>
        </nav>
      </header>
      <main style={{ padding: '1.5rem' }}>
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
