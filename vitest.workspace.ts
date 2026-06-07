import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/plandesk-web',
  'packages/plandesk-api',
  'packages/plandesk-db',
  'packages/plandesk-mcp',
  'packages/plandesk-cli',
  'packages/plandesk-mcp-client',
]);
