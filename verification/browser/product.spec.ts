import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const demo = JSON.parse(readFileSync(join(root, '.local/private/demo-accounts.json'), 'utf8')) as {
  accounts: { username: string; password: string }[];
};
mkdirSync(join(root, 'docs/images'), { recursive: true });
async function login(page: Page, username: string) {
  const account = demo.accounts.find((item) => item.username === username)!;
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Less searching. More knowing.' })).toBeVisible();
  await expect(page.locator('.count')).not.toHaveText('…');
}

test('login errors and a controlled provider outage recover without a substituted answer', async ({
  page,
}) => {
  const account = demo.accounts.find((item) => item.username === 'alex')!;
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('alex');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-synthetic-password');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByText('Offline fixture', { exact: true })).toBeVisible();
  await expect(page.locator('.count')).toHaveText('4');
  // Explicit API-error fixture; this is not represented as an observed Google outage.
  await page.route('**/turns', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'PROVIDER_UNAVAILABLE',
        status: 503,
        detail: 'Controlled provider outage. No answer was substituted.',
        requestId: 'browser-error-fixture',
      }),
    }),
  );
  await page.getByLabel('Ask your workspace knowledge').fill('What is our hybrid work policy?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No answer was substituted');
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await page.unroute('**/turns');
  await page.getByLabel('Ask your workspace knowledge').fill('What is our hybrid work policy?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.getByText('Source-backed', { exact: true })).toBeVisible();
});

test('member questions, trusted sources, history and safe document rendering', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const external: string[] = [];
  const failures: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4280/'))
      external.push(new URL(request.url()).hostname);
  });
  page.on('pageerror', () => failures.push('browser-error'));
  await login(page, 'alex');
  await expect(page.getByText('Offline fixture', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(root, 'docs/images/workspace-fixture.png'), fullPage: true });
  await page.getByRole('button', { name: /GET SETTLED/ }).click();
  await expect(page.getByText('Source-backed', { exact: true })).toBeVisible();
  await expect(page.locator('.message.assistant')).toContainText('Offline fixture');
  await page.locator('.source-chip').first().click();
  await expect(page.getByText('Current access checked', { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(root, 'docs/images/answer-and-source-fixture.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close source' }).click();
  await page.getByRole('button', { name: /Knowledge library/ }).click();
  await expect(page.getByRole('button', { name: /People team: compensation review/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: /^Imported supplier note/ }).click();
  await expect(page.locator('.source-content')).toContainText('prompt-injection specimen');
  expect(
    await page.locator('script:not([src]), .source-content img, .source-content a').count(),
  ).toBe(0);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
  await page.getByRole('button', { name: 'Close source' }).click();
  await page.reload();
  await page.locator('.thread-item').first().click();
  await expect(page.getByText('Source-backed', { exact: true })).toBeVisible();
});

test('dual-workspace navigation clears prior content and mobile layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'sam');
  await page.screenshot({
    path: join(root, 'docs/images/mobile-workspace-fixture.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByLabel('Current workspace').selectOption({ label: 'Northstar Studio' });
  await expect(page.locator('.breadcrumb')).toContainText('Northstar Studio');
  await page.getByLabel('Current workspace').selectOption({ label: 'Harbor Research' });
  await expect(page.locator('.breadcrumb')).toContainText('Harbor Research');
  await page.getByRole('button', { name: /Knowledge library/ }).click();
  await expect(
    page.locator('.document-list').getByRole('button', { name: /^Harbor project onboarding/ }),
  ).toBeVisible();
  await expect(
    page.locator('.document-list').getByRole('button', { name: /^Working at Northstar/ }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('HR sees restricted knowledge without admin mutation controls', async ({ page }) => {
  await login(page, 'riley');
  await page.getByRole('button', { name: /Knowledge library/ }).click();
  await expect(
    page.getByRole('button', { name: /^People team: compensation review/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add document', exact: true })).toHaveCount(0);
});

test('administrator ingests and removes a document through human-only controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'jordan');
  await page.getByRole('button', { name: /Knowledge library/ }).click();
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await page.getByLabel('Document title', { exact: true }).fill('Browser verification checklist');
  await page
    .getByLabel('Source text', { exact: true })
    .fill('This is synthetic browser verification knowledge. The checklist owner is Wren.');
  await page.getByRole('button', { name: 'Add to knowledge' }).click();
  await expect(page.getByRole('button', { name: /^Browser verification checklist/ })).toBeVisible();
  await page.screenshot({
    path: join(root, 'docs/images/knowledge-admin-fixture.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Change visibility: Browser verification checklist', exact: true })
    .click();
  await expect(
    page.locator('.document-row').filter({ hasText: 'Browser verification checklist' }),
  ).toContainText('People · restricted');
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Remove: Browser verification checklist', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /^Browser verification checklist/ })).toHaveCount(
    0,
  );
});

test('a delayed thread response cannot appear after switching workspaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'sam');
  const session = await (await page.request.get('/api/session')).json();
  const north = session.workspaces.find(
    (item: { name: string }) => item.name === 'Northstar Studio',
  ).id;
  const headers = { origin: 'http://127.0.0.1:4280', 'x-csrf-token': session.csrfToken };
  const created = await (
    await page.request.post('/api/workspaces/' + north + '/conversations', {
      headers,
      data: { title: 'Race boundary check' },
    })
  ).json();
  await page.request.post(
    '/api/workspaces/' + north + '/conversations/' + created.conversation.id + '/turns',
    {
      headers,
      data: { question: 'What is our hybrid work policy?', requestKey: crypto.randomUUID() },
    },
  );
  await page.reload();
  await page.getByLabel('Current workspace').selectOption({ label: 'Northstar Studio' });
  await expect(
    page.locator('.thread-item').filter({ hasText: 'Race boundary check' }).first(),
  ).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/conversations/' + created.conversation.id + '/messages', async (route) => {
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response });
  });
  await page.locator('.thread-item').filter({ hasText: 'Race boundary check' }).first().click();
  await requested;
  await page.getByLabel('Current workspace').selectOption({ label: 'Harbor Research' });
  await expect(page.locator('.breadcrumb')).toContainText('Harbor Research');
  const delivered = page.waitForResponse(
    '**/conversations/' + created.conversation.id + '/messages',
  );
  release();
  await delivered;
  // The controlled response has arrived; allow React's scheduled update to commit.
  await page.waitForTimeout(150);
  await expect(page.locator('.message.user')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Less searching. More knowing.' })).toBeVisible();
});
