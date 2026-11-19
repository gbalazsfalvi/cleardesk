import { modelAnswer, readSourceInput, searchInput } from '@cleardesk/contracts';
import type { KnowledgeClient } from '../data-client.js';
import type { ScopedTools, SourceChunk, VerifiedAnswer } from './types.js';

/** Authority is captured by the server closure, never present in an LLM tool schema. */
export function scopedTools(client: KnowledgeClient, token: string, prefix: string): ScopedTools {
  const registry = new Map<string, SourceChunk>();
  let calls = 0;
  const keep = (chunks: SourceChunk[]) => {
    for (const chunk of chunks) registry.set(chunk.chunkId, chunk);
    return chunks;
  };
  return {
    registry,
    async search(input) {
      const parsed = searchInput.parse(input);
      if (++calls > 3) throw new Error('TOOL_LIMIT');
      return keep(
        (await client.request<{ chunks: SourceChunk[] }>(prefix + '/search', token, parsed)).chunks,
      );
    },
    async read(input) {
      const parsed = readSourceInput.parse(input);
      if (++calls > 3) throw new Error('TOOL_LIMIT');
      return keep(
        (await client.request<{ chunks: SourceChunk[] }>(prefix + '/read', token, parsed)).chunks,
      );
    },
  };
}

/** Provenance check only: source membership does not prove the model's semantic accuracy. */
export function gateAnswer(output: unknown, registry: Map<string, SourceChunk>): VerifiedAnswer {
  const answer = modelAnswer.parse(output);
  const seen = new Set<string>();
  const citations: typeof answer.citations = [];
  for (const citation of answer.citations) {
    if (registry.get(citation.chunkId)?.documentId !== citation.documentId)
      throw new Error('UNVERIFIED_RESPONSE');
    if (seen.has(citation.chunkId)) continue;
    seen.add(citation.chunkId);
    citations.push(citation);
  }
  return { ...answer, citations };
}
