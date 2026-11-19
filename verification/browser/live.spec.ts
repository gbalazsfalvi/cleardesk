import { stateDirectory } from '../../apps/api/src/state.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { TurnReply } from '@cleardesk/contracts';
import { provenance } from '../report.js';
import { ProviderBudget } from '../../apps/api/src/ai/provider-budget.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
interface BrowserObservation {
  kind: 'live-gemini-browser';
  status: 'PASS' | 'ERROR' | 'INCOMPLETE';
  generatedAt: string;
  provenance: ReturnType<typeof provenance> | null;
  model: TurnReply['model'] | null;
  generationRequests: number | null;
  budgetSpent: number | null;
  limit: null;
  maxGenerationRequestsPerRun: 2;
  usage: TurnReply['usage'] | null;
  checks: {
    expectedAnswer: boolean;
    sourceOpenedWithCurrentAccess: boolean;
    liveModeVisible: boolean;
    noExternalBrowserRequests: boolean;
  };
  screenshot: string | null;
  capture: string | null;
  screenshotSha256: string | null;
  errorCode: 'BROWSER_ASSERTION_FAILED' | null;
}

test('bounded-live-browser: actual Gemini answer and trusted source', async ({ page }) => {
  test.skip(
    process.env.CLEARDESK_LIVE_BROWSER !== '1',
    'Explicit opt-in required; offline checks never spend a generation request.',
  );
  const budget = new ProviderBudget(
    join(stateDirectory(root), 'private', 'application-usage.json'),
    null,
  );
  const generatedAt = new Date().toISOString();
  const directory = join(
    root,
    'artifacts/runs/browser-live',
    generatedAt.replaceAll(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8),
  );
  mkdirSync(directory, { recursive: true });
  let before: number | null = null;
  const record: BrowserObservation = {
    kind: 'live-gemini-browser',
    status: 'INCOMPLETE',
    generatedAt,
    provenance: null,
    model: null,
    generationRequests: null,
    budgetSpent: null,
    limit: null,
    maxGenerationRequestsPerRun: 2,
    usage: null,
    checks: {
      expectedAnswer: false,
      sourceOpenedWithCurrentAccess: false,
      liveModeVisible: false,
      noExternalBrowserRequests: false,
    },
    screenshot: null,
    capture: null,
    screenshotSha256: null,
    errorCode: null,
  };
  try {
    before = budget.snapshot().spent;
    record.provenance = provenance(root);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const external: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4280/'))
        external.push(new URL(request.url()).hostname);
    });
    const demo = JSON.parse(
      readFileSync(join(stateDirectory(root), 'private', 'demo-accounts.json'), 'utf8'),
    );
    const account = demo.accounts.find((item: { username: string }) => item.username === 'jordan');
    await page.goto('/');
    await page.getByLabel('Username', { exact: true }).fill(account.username);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await expect(page.getByText('Gemini · live', { exact: true })).toBeVisible();
    record.checks.liveModeVisible = true;
    await page
      .getByLabel('Current workspace', { exact: true })
      .selectOption({ label: 'Northstar Studio' });
    await expect(page.locator('.count')).toHaveText('5');
    const completed = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/turns'),
    );
    await page.getByLabel('Ask your workspace knowledge').fill('How do I claim travel expenses?');
    await page.getByRole('button', { name: 'Send question', exact: true }).click();
    const response = await completed;
    const result = (await response.json()) as TurnReply;
    expect(response.status()).toBe(200);
    expect(result.status).toBe('ANSWERED');
    expect(result.model.mode).toBe('live');
    expect(result.model.id).toBe('gemini-3.5-flash-lite');
    record.model = { mode: result.model.mode, id: result.model.id, version: result.model.version };
    record.usage = result.usage
      ? {
          calls: result.usage.calls,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        }
      : null;
    await expect(page.locator('.message.assistant')).toContainText(/30 days|thirty days/i);
    await expect(page.locator('.message.assistant')).not.toContainText('Offline fixture');
    record.checks.expectedAnswer = true;
    await page.locator('.source-chip').filter({ hasText: 'Travel & expenses' }).first().click();
    await expect(page.getByText('Current access checked', { exact: true })).toBeVisible();
    record.checks.sourceOpenedWithCurrentAccess = true;
    // The capture stays in this run; a reviewed copy may later be promoted into documentation.
    const screenshot = join(directory, 'screenshot.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    record.screenshot = null;
    record.capture = 'screenshot.png';
    record.screenshotSha256 = createHash('sha256').update(readFileSync(screenshot)).digest('hex');
    const after = budget.snapshot().spent;
    expect(after - before).toBeGreaterThanOrEqual(1);
    expect(after - before).toBeLessThanOrEqual(2);
    expect(external).toEqual([]);
    record.checks.noExternalBrowserRequests = true;
    record.status = 'PASS';
  } catch (error) {
    record.status = 'ERROR';
    record.errorCode = 'BROWSER_ASSERTION_FAILED';
    throw error;
  } finally {
    // A later failed smoke must remain the latest observation, rather than selecting an older PASS.
    try {
      record.budgetSpent = budget.snapshot().spent;
      if (before !== null) record.generationRequests = record.budgetSpent - before;
    } catch {
      record.budgetSpent = null;
      record.generationRequests = null;
    }
    const serialized = JSON.stringify(record, null, 2) + '\n';
    writeFileSync(join(directory, 'report.json'), serialized);
    const hashes = [createHash('sha256').update(serialized).digest('hex') + '  report.json'];
    if (record.capture && record.screenshotSha256)
      hashes.push(record.screenshotSha256 + '  screenshot.png');
    writeFileSync(join(directory, 'SHA256SUMS'), hashes.join('\n') + '\n');
  }
});
