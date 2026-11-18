import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderBudget, createBudgetedFetch } from '../src/ai/provider-budget.js';
import { removeOwnedTemporaryDirectory } from '../../../verification/owned-temporary.js';

const directories: string[] = [];
function ledger() {
  const directory = mkdtempSync(join(tmpdir(), 'cleardesk-budget-'));
  directories.push(directory);
  return join(directory, 'calls.json');
}
afterEach(() => directories.splice(0).forEach(removeOwnedTemporaryDirectory));
const endpoint =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
const body = JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: 'Synthetic question' }] }],
  generationConfig: { maxOutputTokens: 512 },
});

describe('persistent generation admission', () => {
  it('rejects an unexpected tool surface before spending a generation request', async () => {
    const path = ledger();
    const upstream = vi.fn().mockResolvedValue(new Response('{}'));
    const guarded = createBudgetedFetch(new ProviderBudget(path, 12), upstream);
    const unsafe = {
      ...JSON.parse(body),
      tools: [{ functionDeclarations: [{ name: 'readFile', parameters: {} }] }],
    };
    await expect(
      guarded(endpoint, { method: 'POST', body: JSON.stringify(unsafe) }),
    ).rejects.toThrow('PROVIDER_REQUEST_REJECTED');
    expect(upstream).not.toHaveBeenCalled();
    expect(new ProviderBudget(path, 12).snapshot().spent).toBe(0);
  });

  it('rejects unknown or authority-forging model tool calls before Mastra can dispatch them', async () => {
    for (const functionCall of [
      { name: 'readFile', args: { path: '+(*a)' } },
      { name: 'searchKnowledge', args: { query: 'policy', role: 'ADMIN' } },
    ]) {
      const path = ledger();
      const upstream = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ functionCall }] } }] }),
          ),
        );
      await expect(
        createBudgetedFetch(new ProviderBudget(path, 12), upstream)(endpoint, {
          method: 'POST',
          body,
        }),
      ).rejects.toThrow('UNVERIFIED_RESPONSE');
      expect(new ProviderBudget(path, 12).snapshot().spent).toBe(1);
    }
  });
  it('counts retries and survives reconstruction without refunding a failed request', async () => {
    const path = ledger();
    const upstream = vi.fn().mockRejectedValue(new Error('transport failed'));
    const first = createBudgetedFetch(new ProviderBudget(path, 2), upstream);
    await expect(first(endpoint, { method: 'POST', body })).rejects.toThrow('transport failed');
    const second = createBudgetedFetch(new ProviderBudget(path, 2), upstream);
    await expect(second(endpoint, { method: 'POST', body })).rejects.toThrow('transport failed');
    await expect(second(endpoint, { method: 'POST', body })).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(path, 'utf8')).attempts).toHaveLength(2);
  });

  it('admits only the official fixed model endpoint and bounded output before spending', async () => {
    const path = ledger();
    const upstream = vi.fn().mockResolvedValue(new Response('{}'));
    const guarded = createBudgetedFetch(new ProviderBudget(path, 12), upstream);
    for (const url of [
      'https://example.invalid/generateContent',
      endpoint.replace('gemini-3.5-flash-lite', 'other'),
      endpoint + '?key=forbidden',
    ]) {
      await expect(guarded(url, { method: 'POST', body })).rejects.toThrow(
        'PROVIDER_REQUEST_REJECTED',
      );
    }
    await expect(
      guarded(endpoint, { method: 'POST', body: body.replace('512', '9999') }),
    ).rejects.toThrow('PROVIDER_REQUEST_REJECTED');
    expect(upstream).not.toHaveBeenCalled();
    expect(new ProviderBudget(path, 12).snapshot().spent).toBe(0);
  });

  it('fails closed for corruption and a changed cap', () => {
    const path = ledger();
    writeFileSync(path, '{corrupt');
    expect(() => new ProviderBudget(path, 12).reserve()).toThrow('BUDGET_STATE_INVALID');
    rmSync(path);
    new ProviderBudget(path, 2).reserve();
    expect(() => new ProviderBudget(path, 12).reserve()).toThrow('BUDGET_STATE_INVALID');
  });

  it('forces redirect rejection and never writes request content or headers to its ledger', async () => {
    const path = ledger();
    const upstream = vi.fn().mockResolvedValue(new Response('{}'));
    await createBudgetedFetch(new ProviderBudget(path, 12), upstream)(endpoint, {
      method: 'POST',
      body,
      headers: { 'x-goog-api-key': 'synthetic-secret' },
      redirect: 'follow',
    });
    expect(upstream.mock.calls[0]?.[1].redirect).toBe('error');
    const saved = readFileSync(path, 'utf8');
    expect(saved).not.toContain('Synthetic question');
    expect(saved).not.toContain('synthetic-secret');
  });
});
