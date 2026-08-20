import { expect, test, type Page } from '@playwright/test';
import { startHarnessServer, type HarnessServer } from './fixtures/server';

test.describe.configure({ mode: 'serial' });

let server: HarnessServer;

test.beforeAll(async () => {
  server = await startHarnessServer();
});

test.afterAll(async () => {
  await server.stop();
});

async function openCanvas(page: Page, prototypeId: string): Promise<void> {
  await page.goto(`${server.baseUrl}/projects/${server.projectId}/prototypes/${prototypeId}`);
  await page.waitForSelector('[data-prototype-canvas]', { timeout: 15_000 });
}

// Titles are unique per flow on purpose. Write-time link resolution matches by
// title across the whole project when no screen in this prototype carries the
// name yet, so two flows that both call a screen "Pay" bind each other's links
// instead of their own.
let flowSeq = 0;

async function seedTwoScreenFlow(name: string, width = 390, height = 844) {
  flowSeq += 1;
  const homeTitle = `Home ${String(flowSeq)}`;
  const payTitle = `Pay ${String(flowSeq)}`;
  const proto = await server.seedPrototype(name, width, height);
  const home = await server.seedPrototypeScreen(
    proto.id,
    homeTitle,
    `<!doctype html><html><body><a id="go" href="plandesk://artifact/${payTitle}">Pay</a></body></html>`,
  );
  const pay = await server.seedPrototypeScreen(
    proto.id,
    payTitle,
    `<!doctype html><html><body><p id="paid">Pay</p></body></html>`,
  );
  return { proto, home, pay };
}

test('Preview enters on the first screen and puts it in the URL', async ({ page }) => {
  const { proto, home } = await seedTwoScreenFlow('Preview entry');

  await openCanvas(page, proto.id);
  await page.locator('[data-present-enter]').click();

  await expect(page.locator('[data-present-stage]')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`/prototypes/${proto.id}/present/${home.id}$`));
  await expect(page.locator('[data-present-stage]')).toHaveAttribute('data-artifact-id', home.id);
  await expect(page.locator('[data-present-stage]')).toHaveAttribute('data-present-total', '2');
});

test('a link click walks the flow and moves the URL with it', async ({ page }) => {
  const { proto, home, pay } = await seedTwoScreenFlow('Preview walk');

  await page.goto(
    `${server.baseUrl}/projects/${server.projectId}/prototypes/${proto.id}/present/${home.id}`,
  );
  await expect(page.locator('[data-present-frame]')).toBeVisible({ timeout: 10_000 });

  await page.frameLocator('[data-present-frame]').locator('#go').click();

  await expect(page).toHaveURL(new RegExp(`/present/${pay.id}$`), { timeout: 10_000 });
  await expect(page.locator('[data-present-stage]')).toHaveAttribute('data-artifact-id', pay.id);
});

test('a deep link opens straight onto its screen', async ({ page }) => {
  const { proto, pay } = await seedTwoScreenFlow('Preview deep link');

  await page.goto(
    `${server.baseUrl}/projects/${server.projectId}/prototypes/${proto.id}/present/${pay.id}`,
  );

  await expect(page.locator('[data-present-stage]')).toHaveAttribute('data-artifact-id', pay.id, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-present-stage]')).toHaveAttribute('data-present-index', '2');
});

test('the step controls move between screens and clamp at the ends', async ({ page }) => {
  const { proto, home, pay } = await seedTwoScreenFlow('Preview stepping');

  await page.goto(
    `${server.baseUrl}/projects/${server.projectId}/prototypes/${proto.id}/present/${home.id}`,
  );
  const stage = page.locator('[data-present-stage]');
  await expect(stage).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('button', { name: 'Previous screen' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next screen' }).click();

  await expect(stage).toHaveAttribute('data-artifact-id', pay.id);
  await expect(page.getByRole('button', { name: 'Next screen' })).toBeDisabled();
});

test('a screen wider than the window scales down instead of being cropped', async ({ page }) => {
  const { proto, home } = await seedTwoScreenFlow('Preview scaling', 2400, 1400);

  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(
    `${server.baseUrl}/projects/${server.projectId}/prototypes/${proto.id}/present/${home.id}`,
  );

  const stage = page.locator('[data-present-stage]');
  await expect(stage).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => Number(await stage.getAttribute('data-present-scale')))
    .toBeLessThan(1);

  const box = await page.locator('[data-present-frame]').boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeLessThanOrEqual(900);
});

test('Exit returns to the canvas', async ({ page }) => {
  const { proto, home } = await seedTwoScreenFlow('Preview exit');

  await page.goto(
    `${server.baseUrl}/projects/${server.projectId}/prototypes/${proto.id}/present/${home.id}`,
  );
  await expect(page.locator('[data-present-stage]')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-present-exit]').click();

  await expect(page.locator('[data-prototype-canvas]')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`/prototypes/${proto.id}$`));
});
