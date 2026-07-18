import { Link, createFileRoute } from '@tanstack/react-router';
import { Members } from '../components/settings/Members.js';

function MembersSettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight">Members</h2>
          <span className="text-xs text-muted-foreground">
            Invite teammates and review org membership.
          </span>
        </div>
        <nav className="mb-6 flex flex-wrap gap-3 text-sm" aria-label="Settings sections">
          <Link to="/settings/members" className="font-medium text-foreground underline-offset-4">
            Members
          </Link>
          <Link
            to="/settings/mcp"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            MCP / CLI token
          </Link>
        </nav>
        <div className="mb-10">
          <Members />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings/members')({
  component: MembersSettingsPage,
});
