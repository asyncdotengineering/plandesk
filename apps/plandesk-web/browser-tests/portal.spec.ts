import { expect, test } from '@playwright/test';
import { startHarnessServer, type HarnessServer } from './fixtures/server';

/**
 * Acceptance criterion 10: a portal guest opens a share link, walks the flow,
 * and the screens render.
 *
 * This suite exists because the criterion was once reported green on the
 * strength of an API test plus a jsdom mapping test, while the route in a real
 * browser rendered the share landing page instead of the canvas — the parent
 * route's component omitted its `Outlet`, so no child ever mounted. Neither of
 * those tests renders the router, so neither could see it. The assertions below
 * are deliberately about what is on screen, not about what a function returns.
 */

test.describe.configure({ mode: 'serial' });

let server: HarnessServer;

test.beforeAll(async () => {
  server = await startHarnessServer();
});

test.afterAll(async () => {
  await server.stop();
});

const SCREEN = (label: string, link?: string) => `<!doctype html>
<html><body>
<h1>${label}</h1>
${link === undefined ? '' : `<a href="plandesk://artifact/${link}">Go to ${link}</a>`}
<script>parent.postMessage({ kind: 'plandesk:ready' }, '*');</script>
</body></html>`;

async function seedSharedPrototype(): Promise<{ token: string; prototypeId: string }> {
  const proto = await server.seedPrototype('Guest flow', 390, 844);
  await server.seedPrototypeScreen(proto.id, 'Cart', SCREEN('Cart', 'Pay'));
  await server.seedPrototypeScreen(proto.id, 'Pay', SCREEN('Pay'));
  const share = await server.sharePrototype(proto.id);
  return { token: share.token, prototypeId: proto.id };
}

test('a guest with no session joins a share link and reaches the prototype canvas', async ({
  browser,
}) => {
  const { token, prototypeId } = await seedSharedPrototype();

  // A fresh context carries no cookie and no storage — a real guest.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${server.baseUrl}/p/${token}`);

  // The join gate stands between a guest and the content.
  await page.getByLabel(/name/i).first().fill('Guest Reviewer');
  await page.getByRole('button', { name: /join/i }).click();

  await page.getByRole('link', { name: /guest flow/i }).click();

  // The canvas must actually mount — this is the assertion the jsdom test
  // could not make.
  await page.waitForSelector('[data-prototype-canvas]', { timeout: 15_000 });
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('iframe').first()).toHaveAttribute('src', /\/render/);

  expect(page.url()).toContain(`/p/${token}/prototypes/${prototypeId}`);

  await context.close();
});

test('a direct load of the prototype route renders the canvas, not the landing page', async ({
  browser,
}) => {
  const { token, prototypeId } = await seedSharedPrototype();

  const context = await browser.newContext();
  const page = await context.newPage();

  // Join first so the guest session exists, then navigate straight to the
  // nested route — a fresh load, not a client-side transition. This is the
  // path that regressed: client-side clicks and direct loads resolve the same
  // route tree, and both rendered the parent's own page.
  await page.goto(`${server.baseUrl}/p/${token}`);
  await page.getByLabel(/name/i).first().fill('Guest Reviewer');
  await page.getByRole('button', { name: /join/i }).click();
  await page.getByRole('link', { name: /guest flow/i }).waitFor();

  await page.goto(`${server.baseUrl}/p/${token}/prototypes/${prototypeId}`);

  await page.waitForSelector('[data-prototype-canvas]', { timeout: 15_000 });
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('an unjoined guest hitting a nested portal route still gets the join gate', async ({
  browser,
}) => {
  const { token, prototypeId } = await seedSharedPrototype();

  const context = await browser.newContext();
  const page = await context.newPage();

  // Straight to the nested route with no session at all. Making the parent a
  // pure Outlet moved the gate into each child, so this asserts the gate did
  // not get lost on the way.
  await page.goto(`${server.baseUrl}/p/${token}/prototypes/${prototypeId}`);

  await expect(page.getByRole('button', { name: /join/i })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  await context.close();
});
