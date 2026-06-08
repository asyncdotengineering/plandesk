import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

export default defineConfig({
  site: 'https://plandesk-docs.pages.dev',
  integrations: [
    starlight({
      title: 'Plan Desk',
      description:
        'Local-first, self-hostable planning workspace — canvas, docs-on-nodes, tasks, board, and MCP for agent workflows.',
      logo: { src: './src/assets/logo.svg' },
      customCss: ['./src/styles/docs-theme.css'],
      head: [
        {
          tag: 'script',
          content:
            "document.documentElement.setAttribute('data-theme','light');try{localStorage.setItem('starlight-theme','light')}catch(e){}",
        },
      ],
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      plugins: [
        starlightLlmsTxt({
          projectName: 'Plan Desk',
          description:
            'Plan Desk is a local-first, self-hostable planning workspace: a flow canvas of task nodes with labeled dependency edges, specs attached to nodes, a board, and an MCP server (18 tools) that coding agents use to scaffold plans, pick the next task, and update status live.',
          details:
            'Set up for an agent in one prompt: "Read https://plandesk-docs.pages.dev/start.md then set up Plan Desk for this project." Published on npm as @plandesk/cli.',
        }),
      ],
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
            { slug: 'introduction' },
            { slug: 'getting-started/quickstart' },
            { slug: 'getting-started/first-project' },
          ],
        },
        {
          label: 'Guides',
          items: [{ slug: 'guides/idea-to-development' }, { slug: 'guides/plan-and-execute' }],
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
