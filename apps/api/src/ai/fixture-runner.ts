import type { ModelRunner } from './types.js';

/** Offline extractive fixture, visibly labelled; never presented as a Gemini completion. */
export const fixtureRunner: ModelRunner = {
  async run({ chunks, signal }) {
    if (signal.aborted) throw new Error('REQUEST_CANCELLED');
    const chunk = chunks[0];
    return {
      model: { mode: 'fixture', id: 'extractive-fixture', version: '1' },
      output: chunk
        ? {
            kind: 'answer',
            answer: `**Offline fixture — source excerpt**\n\n${chunk.text.slice(0, 700)}\n\nThis is an extractive demonstration, not a live model answer.`,
            citations: [{ documentId: chunk.documentId, chunkId: chunk.chunkId }],
          }
        : {
            kind: 'insufficient',
            answer: 'There is not enough accessible knowledge to answer this question.',
            citations: [],
          },
    };
  },
};
