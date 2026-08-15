import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

export default defineConfig({
  site: 'https://plandesk.asyncdot.com',
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
            'Plan Desk is a local-first, self-hostable planning workspace: a flow canvas of task nodes with labeled dependency edges, specs attached to nodes, a board, and an MCP server (64 tools) that coding agents use to scaffold plans, pick the next task, and update status live.',
          details:
            'Set up for an agent in one prompt: "Read https://plandesk.asyncdot.com/start.md then set up Plan Desk for this project." Published on npm as @plandesk/cli. Collaboration (portal + moderated inbox) runs on the same Plan Desk API — one server, not a separate sync package.',
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
          items: [
            { slug: 'guides/start-with-an-idea' },
            { slug: 'guides/research-plan-build-share' },
            { slug: 'guides/idea-to-development' },
            { slug: 'guides/plan-and-execute' },
            { slug: 'guides/drive-the-factory' },
            { slug: 'guides/plan-share-build' },
            { slug: 'guides/going-online' },
            { slug: 'guides/self-host-for-teams' },
          ],
        },
        {
          label: 'Self-Hosting',
          items: [
            { slug: 'self-hosting/topologies' },
            { slug: 'self-hosting/server-config' },
            { slug: 'self-hosting/docker' },
            { slug: 'self-hosting/cloudflare' },
            { slug: 'self-hosting/sync-server' }, // single-server collab page (legacy slug)
          ],
        },
        {
          label: 'Connecting Agents',
          items: [
            { slug: 'connecting-agents/mcp-setup' },
            { slug: 'connecting-agents/connect' },
            { slug: 'connecting-agents/skill' },
            { slug: 'connecting-agents/mcporter' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/cli' },
            { slug: 'reference/goals' },
            { slug: 'reference/prototypes' },
            { slug: 'reference/how-the-factory-works' },
            { slug: 'reference/factory' },
            { slug: 'reference/api' },
            { slug: 'reference/architecture' },
            { slug: 'reference/workspaces' },
            { slug: 'reference/collaboration' },
            { slug: 'reference/upgrading' },
            { slug: 'reference/troubleshooting' },
            { slug: 'reference/validation-metrics' },
          ],
        },
        {
          label: 'Blog',
          items: [{ slug: 'blog/beta-launch' }],
        },
      ],
    }),
  ],
});
