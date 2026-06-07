import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://plandesk-docs.pages.dev',
  integrations: [
    starlight({
      title: 'Plan Desk',
      description:
        'Local-first, self-hostable planning workspace — canvas, docs-on-nodes, tasks, board, and MCP for agent workflows.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/asyncdotengineering/plandesk',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/asyncdotengineering/plandesk/edit/main/apps/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { slug: 'index' },
            { slug: 'getting-started/quickstart' },
            { slug: 'getting-started/first-project' },
          ],
        },
        {
          label: 'Guides',
          items: [{ slug: 'guides/plan-and-execute' }],
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
