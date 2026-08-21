import { expect, test, type Page } from '@playwright/test';
import { startHarnessServer, type HarnessServer } from './fixtures/server';

/**
 * The responsive gate.
 *
 * A document-level overflow check is NOT enough here: `.app` is
 * `height:100vh; overflow:hidden`, so a shell route clips its content rather
 * than widening the page. On a 390px phone the board is unreadable while
 * `document.scrollWidth === innerWidth`. The discriminative measurement is how
 * much of the viewport the content column actually gets.
 */

// Not `serial`: a gate must report every offending route, not stop at the first.
// playwright.config.ts already pins workers to 1, so the shared harness is safe.

type Viewport = { name: string; width: number; height: number };

const VIEWPORTS: Viewport[] = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** Below this the shell must collapse to a drawer. Mirrors Tailwind `lg`. */
const DESKTOP_MIN = 1024;

type Seed = {
  projectId: string;
  documentId: string;
  noteId: string;
  prototypeId: string;
  screenId: string;
  shareToken: string;
};

type Route = {
  name: string;
  path: (seed: Seed) => string;
  /** Shell routes render inside `.app`; chromeless ones own the viewport. */
  chrome: 'shell' | 'chromeless';
  /**
   * Horizontal scroll inside the content column is intended here — a kanban
   * strip and a wide table are legitimate. Everything else must fit.
   */
  scrollsHorizontally?: boolean;
  /** Selector that proves the route finished rendering. */
  ready?: string;
  /** Runs before the route is opened — the portal needs its join gate cleared. */
  prepare?: (page: Page) => Promise<void>;
};

/**
 * A share portal puts a join gate in front of a guest. Clear it in the same
 * context before navigating to the nested canvas, or the canvas never mounts.
 */
async function joinPortal(page: Page): Promise<void> {
  await page.goto(`${server.baseUrl}/p/${seed.shareToken}`);
  await page.getByLabel(/name/i).first().fill('Responsive Guest');
  await page.getByRole('button', { name: /join/i }).click();
  await page.waitForSelector('a[href*="/prototypes/"]', { timeout: 20_000 });
}

const ROUTES: Route[] = [
  // The workspace landing is deliberately rootless — it owns its own centred
  // layout and never mounts the AppShell (see ROOTLESS_PATHS in __root.tsx).
  { name: 'landing', path: () => `/`, chrome: 'chromeless' },
  { name: 'overview', path: (s) => `/projects/${s.projectId}/overview`, chrome: 'shell' },
  {
    name: 'board',
    path: (s) => `/projects/${s.projectId}/board`,
    chrome: 'shell',
    scrollsHorizontally: true,
  },
  {
    name: 'list',
    path: (s) => `/projects/${s.projectId}/list`,
    chrome: 'shell',
    scrollsHorizontally: true,
  },
  { name: 'flow', path: (s) => `/projects/${s.projectId}/flow`, chrome: 'shell' },
  { name: 'goals', path: (s) => `/projects/${s.projectId}/goals`, chrome: 'shell' },
  { name: 'prototypes', path: (s) => `/projects/${s.projectId}/prototypes`, chrome: 'shell' },
  { name: 'documents', path: (s) => `/projects/${s.projectId}/documents`, chrome: 'shell' },
  {
    name: 'document detail',
    path: (s) => `/projects/${s.projectId}/documents/${s.documentId}`,
    chrome: 'shell',
  },
  { name: 'notes', path: (s) => `/projects/${s.projectId}/notes`, chrome: 'shell' },
  { name: 'inbox', path: (s) => `/projects/${s.projectId}/inbox`, chrome: 'shell' },
  { name: 'settings mcp', path: () => `/settings/mcp`, chrome: 'shell' },
  { name: 'settings members', path: () => `/settings/members`, chrome: 'shell' },
  {
    name: 'prototype canvas',
    path: (s) => `/projects/${s.projectId}/prototypes/${s.prototypeId}`,
    chrome: 'chromeless',
    ready: '[data-prototype-canvas]',
  },
  {
    name: 'preview',
    path: (s) => `/projects/${s.projectId}/prototypes/${s.prototypeId}/present/${s.screenId}`,
    chrome: 'chromeless',
    ready: '[data-present-stage]',
  },
  // The first thing a client sees when they open a share link on a phone.
  { name: 'portal join gate', path: (s) => `/p/${s.shareToken}`, chrome: 'shell' },
  {
    name: 'portal canvas',
    path: (s) => `/p/${s.shareToken}/prototypes/${s.prototypeId}`,
    chrome: 'chromeless',
    ready: '[data-prototype-canvas]',
    prepare: joinPortal,
  },
];

let server: HarnessServer;
let seed: Seed;

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${url} → ${String(response.status)} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

const LONG_BODY = Array.from(
  { length: 12 },
  (_, i) =>
    `## Section ${String(i + 1)}\n\nA paragraph long enough to exercise the prose measure at a narrow width, with an unbreakable token like supercalifragilisticexpialidocious-token-${String(i)} that a naive layout will let widen the page.\n`,
).join('\n');

test.beforeAll(async () => {
  server = await startHarnessServer();
  const api = `${server.baseUrl}/api/v1`;

  const statuses = ['scope', 'todo', 'in_progress', 'done', 'backlog'] as const;
  for (const status of statuses) {
    for (let i = 0; i < 3; i += 1) {
      await post(`${api}/projects/${server.projectId}/tasks`, {
        label: `${status} task ${String(i + 1)} with a deliberately long label that must wrap on a narrow column`,
        status,
        x: i * 240,
        y: statuses.indexOf(status) * 160,
      });
    }
  }

  const document = await post<{ id: string }>(`${api}/projects/${server.projectId}/documents`, {
    title: 'Responsive fixture document with a long title that will wrap on a phone',
    body: LONG_BODY,
    status_line: 'Ready to implement',
  });

  const note = await post<{ id: string }>(`${api}/projects/${server.projectId}/notes`, {
    title: 'Responsive fixture note',
    body: LONG_BODY,
  });

  const prototype = await server.seedPrototype('Responsive fixture', 1440, 900);
  const screen = await server.seedPrototypeScreen(
    prototype.id,
    'Wide screen',
    `<!doctype html><html><body style="margin:0"><main style="width:1440px;height:900px;background:#eef">wide</main></body></html>`,
  );
  const share = await server.sharePrototype(prototype.id);

  seed = {
    projectId: server.projectId,
    documentId: document.id,
    noteId: note.id,
    prototypeId: prototype.id,
    screenId: screen.id,
    shareToken: share.token,
  };
});

test.afterAll(async () => {
  await server.stop();
});

async function openRoute(page: Page, route: Route, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  if (route.prepare !== undefined) {
    await route.prepare(page);
  }
  await page.goto(`${server.baseUrl}${route.path(seed)}`);
  await page.waitForSelector(route.ready ?? (route.chrome === 'shell' ? '.content' : 'body'), {
    timeout: 20_000,
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** The page itself must never widen. Catches the chromeless routes, which have no `.app` clip. */
async function expectNoDocumentOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: document is ${String(overflow.scrollWidth)}px wide in a ${String(overflow.innerWidth)}px viewport`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/**
 * The content column must own the viewport once the shell collapses — and must
 * not exceed it.
 *
 * Both bounds are load-bearing. `.app` is a `244px 1fr` grid whose `1fr` track
 * has `min-width:auto`, so on a phone the track grows PAST the viewport
 * (418px inside 390px) and `overflow:hidden` clips it. A one-sided ">= 92%"
 * check passes that blown-out grid while the user sees a sliver of content.
 */
async function expectContentOwnsViewport(page: Page, label: string): Promise<void> {
  const measured = await page.evaluate(() => {
    const content = document.querySelector('.content');
    return content === null
      ? null
      : { width: content.getBoundingClientRect().width, innerWidth: window.innerWidth };
  });
  expect(measured, `${label}: no .content element found`).not.toBeNull();
  const { width, innerWidth } = measured as { width: number; innerWidth: number };
  const share = width / innerWidth;
  const detail = `${label}: content column is ${width.toFixed(0)}px of ${String(innerWidth)}px (${(share * 100).toFixed(0)}%)`;
  expect(share, detail).toBeGreaterThan(0.92);
  expect(width, detail).toBeLessThanOrEqual(innerWidth + 1);
}

async function expectContentDoesNotScrollSideways(page: Page, label: string): Promise<void> {
  const measured = await page.evaluate(() => {
    const content = document.querySelector('.content');
    return content === null
      ? null
      : { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
  });
  expect(measured, `${label}: no .content element found`).not.toBeNull();
  const { scrollWidth, clientWidth } = measured as { scrollWidth: number; clientWidth: number };
  expect(
    scrollWidth,
    `${label}: content scrolls sideways — ${String(scrollWidth)}px inside ${String(clientWidth)}px`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

for (const viewport of VIEWPORTS) {
  const isDesktop = viewport.width >= DESKTOP_MIN;

  test.describe(viewport.name, () => {
    for (const route of ROUTES) {
      test(`${route.name} fits the viewport`, async ({ page }) => {
        const label = `${viewport.name} ${route.name}`;
        await openRoute(page, route, viewport);

        await expectNoDocumentOverflow(page, label);

        if (route.chrome === 'shell') {
          if (!isDesktop) {
            await expectContentOwnsViewport(page, label);
          }
          if (route.scrollsHorizontally !== true) {
            await expectContentDoesNotScrollSideways(page, label);
          }
        }
      });
    }

    test('shell exposes the right navigation for this width', async ({ page }) => {
      await openRoute(page, ROUTES[1] as Route, viewport);
      const sidebar = page.locator('[data-app-sidebar]');
      const trigger = page.locator('[data-sidebar-trigger]');

      if (isDesktop) {
        await expect(sidebar, `${viewport.name}: persistent sidebar expected`).toBeVisible();
        await expect(trigger, `${viewport.name}: drawer trigger must be hidden`).toBeHidden();
      } else {
        await expect(trigger, `${viewport.name}: drawer trigger expected`).toBeVisible();
        await expect(sidebar, `${viewport.name}: persistent sidebar must be hidden`).toBeHidden();
      }
    });
  });
}

test.describe('drawer behaviour', () => {
  test('the drawer opens, navigates and closes itself', async ({ page }) => {
    await openRoute(page, ROUTES[1] as Route, VIEWPORTS[0] as Viewport);

    await page.locator('[data-sidebar-trigger]').click();
    const drawer = page.locator('[data-sidebar-drawer]');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/\/board$/);
    // A nav drawer that survives navigation traps the user on the page they left.
    await expect(drawer, 'drawer must close after navigating').toBeHidden();
  });
});
