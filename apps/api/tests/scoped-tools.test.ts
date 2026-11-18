import { describe, expect, it, vi } from 'vitest';
import { gateAnswer, scopedTools } from '../src/ai/scoped-tools.js';
import type { KnowledgeClient } from '../src/data-client.js';
import type { SourceChunk } from '../src/ai/types.js';

const documentId = '00000000-0000-4000-8000-000000000001';
const chunkId = '00000000-0000-4000-8000-000000000002';
const chunk: SourceChunk = {
  documentId,
  chunkId,
  title: 'Trusted title',
  text: 'Synthetic source',
  contentSha256: 'a'.repeat(64),
  version: 1,
  similarity: 1,
};

describe('scoped tool boundary', () => {
  it('rejects a hostile model authority override before contacting storage', async () => {
    const request = vi.fn();
    const tools = scopedTools(
      { request } as unknown as KnowledgeClient,
      'trusted-session',
      '/v1/fixed',
    );
    await expect(
      tools.search({ query: 'payroll', workspaceId: 'other', role: 'ADMIN' }),
    ).rejects.toThrow();
    await expect(tools.read({ sourceId: documentId, session: 'forged' })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('binds requests to its closure and registers only returned chunks', async () => {
    const request = vi.fn().mockResolvedValue({ chunks: [chunk] });
    const tools = scopedTools(
      { request } as unknown as KnowledgeClient,
      'trusted-session',
      '/v1/fixed',
    );
    expect(await tools.search({ query: 'policy' })).toEqual([chunk]);
    expect(request).toHaveBeenCalledWith('/v1/fixed/search', 'trusted-session', {
      query: 'policy',
      limit: 4,
    });
    expect(tools.registry.get(chunkId)).toEqual(chunk);
  });
  it('refuses fabricated citations, wrong document mapping and unsigned answers', () => {
    const registry = new Map([[chunkId, chunk]]);
    expect(() =>
      gateAnswer({ kind: 'answer', answer: 'Unsupported', citations: [] }, registry),
    ).toThrow();
    expect(() =>
      gateAnswer(
        { kind: 'answer', answer: 'Invented', citations: [{ documentId: chunkId, chunkId }] },
        registry,
      ),
    ).toThrow();
    expect(
      gateAnswer(
        { kind: 'answer', answer: 'Sourced', citations: [{ documentId, chunkId }] },
        registry,
      ).kind,
    ).toBe('answer');
  });
});
