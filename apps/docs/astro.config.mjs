import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://plandesk.dev',
  integrations: [
    starlight({
      title: 'Plan Desk',
      description:
        'Local-first, self-hostable planning workspace — canvas, docs-on-nodes, tasks, board, and MCP for agent workflows.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/plan-desk/plandesk',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/plan-desk/plandesk/edit/main/apps/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ slug: 'index' }, { slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Self-Hosting',
          items: [{ slug: 'self-hosting/docker' }],
        },
        {
          label: 'Connecting Agents',
          items: [
            { slug: 'connecting-agents/mcp-setup' },
            { slug: 'connecting-agents/connect' },
            { slug: 'connecting-agents/skill' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/cli' },
            { slug: 'reference/api' },
            { slug: 'reference/architecture' },
            { slug: 'reference/validation-metrics' },
          ],
        },
      ],
    }),
  ],
});
