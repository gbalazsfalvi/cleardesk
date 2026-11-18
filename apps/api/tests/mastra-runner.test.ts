import { mkdtempSync } from 'node:fs';
import { removeOwnedTemporaryDirectory } from '../../../verification/owned-temporary.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { mastraRunner } from '../src/ai/mastra-runner.js';
import { ProviderBudget } from '../src/ai/provider-budget.js';
import type { SourceChunk } from '../src/ai/types.js';

it('runs the installed Mastra/Google adapter through counted synthetic JSON without external traffic', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cleardesk-mastra-'));
  try {
    const chunk: SourceChunk = {
      documentId: '00000000-0000-4000-8000-000000000001',
      chunkId: '00000000-0000-4000-8000-000000000002',
      title: 'Synthetic',
      text: 'Three remote days.',
      contentSha256: 'a'.repeat(64),
      version: 1,
      similarity: 1,
    };
    const output = {
      kind: 'answer',
      answer: 'Three remote days.',
      citations: [{ documentId: chunk.documentId, chunkId: chunk.chunkId }],
    };
    const upstream = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: { role: 'model', parts: [{ text: JSON.stringify(output) }] },
                finishReason: 'STOP',
              },
            ],
            modelVersion: 'synthetic-google-wire-fixture',
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const budget = new ProviderBudget(join(directory, 'calls.json'), 12);
    const runner = mastraRunner('synthetic-test-key-not-a-credential', budget, upstream);
    const result = await runner.run({
      question: 'Remote days?',
      history: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello' },
      ],
      chunks: [chunk],
      tools: {
        registry: new Map([[chunk.chunkId, chunk]]),
        search: async () => [],
        read: async () => [],
      },
      signal: AbortSignal.timeout(10000),
      checkAccess: async () => undefined,
    });
    expect(result.output).toEqual(output);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().spent).toBe(1);
    expect(result.model.version).toBe('synthetic-google-wire-fixture');
  } finally {
    removeOwnedTemporaryDirectory(directory);
  }
});

it('rechecks access before the second model dispatch after a tool observes revocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cleardesk-mastra-revocation-'));
  try {
    let revoked = false;
    const upstream = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'searchKnowledge',
                        args: { query: 'hybrid policy', limit: 1 },
                      },
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            modelVersion: 'synthetic-wire',
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const budget = new ProviderBudget(join(directory, 'attempts.json'), 12);
    const checkAccess = vi.fn(async () => {
      if (revoked) throw new Error('ACCESS_CHANGED');
    });
    const runner = mastraRunner('synthetic-not-a-credential', budget, upstream);
    await expect(
      runner.run({
        question: 'What is the policy?',
        history: [],
        chunks: [],
        tools: {
          registry: new Map(),
          search: async () => {
            revoked = true;
            return [];
          },
          read: async () => [],
        },
        signal: AbortSignal.timeout(10000),
        checkAccess,
      }),
    ).rejects.toThrow('ACCESS_CHANGED');
    expect(checkAccess).toHaveBeenCalledTimes(2);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().spent).toBe(1);
  } finally {
    removeOwnedTemporaryDirectory(directory);
  }
});
