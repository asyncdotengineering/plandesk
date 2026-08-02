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

async function openPrototypeCanvas(page: Page, prototypeId: string): Promise<void> {
  await page.goto(`${server.baseUrl}/projects/${server.projectId}/prototypes/${prototypeId}`);
  await page.waitForSelector('[data-prototype-canvas]', { timeout: 15_000 });
}

async function submitCommentInRail(page: Page, body: string): Promise<void> {
  const rail = page.locator('[data-prototype-comments-rail]');
  await expect(rail).toBeVisible();
  const editor = rail.locator('.ProseMirror, [contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type(body);
  await rail.getByRole('button', { name: /^Comment$/ }).click();
  await expect(page.getByText('Comment added')).toBeVisible({ timeout: 5_000 });
}

test('Comment mode text selection creates anchored artifact comment', async ({ page }) => {
  const proto = await server.seedPrototype('Annotate text', 390, 844);
  const screen = await server.seedPrototypeScreen(
    proto.id,
    'Checkout',
    `<!doctype html><html><body>
      <p id="line">Please confirm your shipping address before checkout.</p>
    </body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-mode="comment"]').click();

  const frame = page.frameLocator(`[data-screen-frame][data-artifact-id="${screen.id}"]`);
  // Triple-click selects the paragraph and fires click while the selection is live.
  await frame.locator('#line').click({ clickCount: 3 });

  await expect(page.locator('[data-prototype-comments-rail]')).toContainText(/shipping address/i, {
    timeout: 5_000,
  });
  await submitCommentInRail(page, 'Please clarify shipping.');

  await expect
    .poll(async () => {
      const comments = await server.listArtifactComments(screen.id);
      return comments.find((c) => c.anchor !== null) ?? null;
    })
    .toMatchObject({
      passage: expect.stringContaining('shipping address'),
      anchor: expect.stringContaining('"mode":"text"'),
    });
});

test('Comment mode click (no drag) produces a point anchor', async ({ page }) => {
  const proto = await server.seedPrototype('Annotate point', 390, 844);
  const screen = await server.seedPrototypeScreen(
    proto.id,
    'Hero',
    `<!doctype html><html><body>
      <img id="hero" width="200" height="100" alt="hero"
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
    </body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-mode="comment"]').click();

  const frame = page.frameLocator(`[data-screen-frame][data-artifact-id="${screen.id}"]`);
  await frame.locator('#hero').click({ position: { x: 40, y: 30 } });

  await expect(page.locator('[data-attached-anchor]')).toBeVisible({ timeout: 5_000 });
  await submitCommentInRail(page, 'Image feels off.');

  const comments = await server.listArtifactComments(screen.id);
  const anchored = comments.find((c) => c.anchor !== null);
  expect(anchored).toBeTruthy();
  const selector = JSON.parse(anchored!.anchor!) as { mode: string; x?: number; y?: number };
  expect(selector.mode).toBe('point');
  expect(typeof selector.x).toBe('number');
  expect(typeof selector.y).toBe('number');
});

test('light edit still resolves; deleting the sentence orphans without mis-attach', async ({
  page,
}) => {
  const proto = await server.seedPrototype('Reanchor', 390, 844);
  const unique = 'The unique purple-widget clause that agents must preserve through light edits.';
  const screen = await server.seedPrototypeScreen(
    proto.id,
    'Copy',
    `<!doctype html><html><body>
      <p id="line">${unique}</p>
      <p id="other">Unrelated green gadgets paragraph stays put.</p>
    </body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-mode="comment"]').click();

  const frame = page.frameLocator(`[data-screen-frame][data-artifact-id="${screen.id}"]`);
  await frame.locator('#line').click({ clickCount: 3 });
  await submitCommentInRail(page, 'Keep this clause.');

  const before = await server.listArtifactComments(screen.id);
  expect(before.some((c) => c.anchor?.includes('purple-widget'))).toBe(true);

  // Light edit: one word change — pin must still resolve.
  const lightlyEdited = unique.replace('preserve', 'retain');
  const patched = await server.patchArtifact(screen.id, {
    content: `<!doctype html><html><body>
      <p id="line">${lightlyEdited}</p>
      <p id="other">Unrelated green gadgets paragraph stays put.</p>
    </body></html>`,
  });
  expect(patched.revision_id).not.toBe(screen.revision_id);

  await expect
    .poll(async () => {
      return page.locator('[data-comment-pin][data-pin-status="resolved"]').count();
    })
    .toBeGreaterThan(0);

  // Delete the sentence entirely — must orphan, never attach to "green gadgets".
  await server.patchArtifact(screen.id, {
    content: `<!doctype html><html><body>
      <p id="other">Unrelated green gadgets paragraph stays put.</p>
    </body></html>`,
  });

  await expect
    .poll(async () => {
      return page.locator('[data-comment-pin][data-pin-status="orphan"]').count();
    })
    .toBeGreaterThan(0);

  // Assert no resolved pin remains for this orphaned comment.
  await expect(page.locator('[data-comment-pin][data-pin-status="resolved"]')).toHaveCount(0);
});

test('pins counter-scale: rendered size stable across zoom levels', async ({ page }) => {
  const proto = await server.seedPrototype('Pin zoom', 390, 844);
  const screen = await server.seedPrototypeScreen(
    proto.id,
    'Zoom',
    `<!doctype html><html><body><p id="t">Zoom pin sentence about checkout flow.</p></body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-mode="comment"]').click();
  const frame = page.frameLocator(`[data-screen-frame][data-artifact-id="${screen.id}"]`);
  await frame.locator('#t').click({ clickCount: 3 });
  await submitCommentInRail(page, 'Zoom check.');

  await expect(page.locator('[data-comment-pin]').first()).toBeVisible({ timeout: 8_000 });

  const sizeAt = async () =>
    page
      .locator('[data-comment-pin]')
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });

  const atDefault = await sizeAt();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const atZoomed = await sizeAt();
  // Counter-scale keeps on-screen size approximately constant (±2px rounding).
  expect(Math.abs(atZoomed.w - atDefault.w)).toBeLessThanOrEqual(2);
  expect(Math.abs(atZoomed.h - atDefault.h)).toBeLessThanOrEqual(2);
});

test('Interact mode does not create a comment from a click', async ({ page }) => {
  const proto = await server.seedPrototype('No annotate interact', 390, 844);
  const screen = await server.seedPrototypeScreen(
    proto.id,
    'Safe',
    `<!doctype html><html><body><p id="t">No comment please.</p></body></html>`,
  );

  await openPrototypeCanvas(page, proto.id);
  await expect(page.locator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.locator('[data-mode="interact"]').click();
  await page
    .frameLocator(`[data-screen-frame][data-artifact-id="${screen.id}"]`)
    .locator('#t')
    .click();

  await expect(page.locator('[data-attached-anchor]')).toHaveCount(0);
  const comments = await server.listArtifactComments(screen.id);
  expect(comments).toHaveLength(0);
});
