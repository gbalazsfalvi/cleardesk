import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProviderBudget, applicationUsage } from '../src/ai/provider-budget.js';
import { removeOwnedTemporaryDirectory } from '../../../verification/owned-temporary.js';

it('tracks ordinary application use beyond twelve requests without imposing a quota', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cleardesk-application-usage-'));
  try {
    const path = join(directory, 'usage.json');
    const usage = new ProviderBudget(path, null);
    for (let index = 0; index < 13; index++) usage.reserve();
    expect(usage.snapshot()).toEqual({ spent: 13, limit: null, remaining: null });
    const restarted = new ProviderBudget(path, null);
    restarted.reserve();
    expect(restarted.snapshot().spent).toBe(14);
    expect(JSON.parse(readFileSync(path, 'utf8')).attempts).toHaveLength(14);
  } finally {
    removeOwnedTemporaryDirectory(directory);
  }
});

it('carries forward every legacy request without changing the bounded verification ledger', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cleardesk-usage-migration-'));
  try {
    const legacy = join(directory, 'delivery.json');
    const current = join(directory, 'application.json');
    const old = new ProviderBudget(legacy, 12);
    for (let index = 0; index < 12; index++) old.reserve();
    const original = readFileSync(legacy);
    const usage = applicationUsage(current, legacy);
    expect(usage.snapshot()).toEqual({ spent: 12, limit: null, remaining: null });
    usage.reserve();
    expect(applicationUsage(current, legacy).snapshot().spent).toBe(13);
    expect(readFileSync(legacy)).toEqual(original);
    expect(old.snapshot().remaining).toBe(0);
  } finally {
    removeOwnedTemporaryDirectory(directory);
  }
});
