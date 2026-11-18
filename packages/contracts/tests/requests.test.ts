import { describe, expect, it } from 'vitest';
import {
  documentInput,
  modelAnswer,
  readSourceInput,
  searchInput,
  turnInput,
} from '../src/index.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('untrusted request contracts', () => {
  it('accepts a normal question with a retry identity', () => {
    expect(
      turnInput.parse({ question: 'What is the remote work policy?', requestKey: id }).question,
    ).toBe('What is the remote work policy?');
  });
  it.each(['actorId', 'workspaceId', 'role', 'session', 'headers'])(
    'rejects forged %s authority',
    (key) => {
      expect(
        turnInput.safeParse({ question: 'Hello', requestKey: id, [key]: 'ADMIN' }).success,
      ).toBe(false);
    },
  );
  it('rejects blank or oversized questions', () => {
    for (const question of ['  ', 'x'.repeat(2001)])
      expect(turnInput.safeParse({ question, requestKey: id }).success).toBe(false);
  });
  it('accepts real text and Markdown documents, including valid Unicode', () => {
    for (const filename of ['handbook.md', 'handbook.txt', 'café.md']) {
      expect(
        documentInput.parse({
          title: 'Handbook',
          filename,
          visibility: 'WORKSPACE',
          text: 'Hello, café 👋',
        }).text,
      ).toBe('Hello, café 👋');
    }
  });
  it('rejects a real NUL character in source text', () => {
    expect(
      documentInput.safeParse({
        title: 'Handbook',
        filename: 'handbook.md',
        visibility: 'WORKSPACE',
        text: 'before' + String.fromCharCode(0) + 'after',
      }).success,
    ).toBe(false);
  });
  it('bounds document bytes rather than just JavaScript characters', () => {
    const input = {
      title: 'Handbook',
      filename: 'handbook.md',
      visibility: 'WORKSPACE',
      text: 'Ã©'.repeat(32769),
    };
    expect(documentInput.safeParse(input).success).toBe(false);
  });
  it.each(['../handbook.md', 'folder/handbook.txt', 'handbook.pdf'])(
    'rejects unsupported filename %s',
    (filename) => {
      expect(
        documentInput.safeParse({
          title: 'Handbook',
          filename,
          visibility: 'WORKSPACE',
          text: 'Hello',
        }).success,
      ).toBe(false);
    },
  );
  it('rejects unpaired surrogates instead of silently replacing source bytes', () => {
    expect(
      documentInput.safeParse({
        title: 'Handbook',
        filename: 'handbook.txt',
        visibility: 'WORKSPACE',
        text: '\ud800',
      }).success,
    ).toBe(false);
  });
  it('tool schemas do not accept a different authority context', () => {
    expect(searchInput.safeParse({ query: 'policy', workspaceId: id }).success).toBe(false);
    expect(readSourceInput.safeParse({ sourceId: id, role: 'ADMIN' }).success).toBe(false);
  });
  it('requires provenance for an answered result', () => {
    expect(
      modelAnswer.safeParse({ kind: 'answer', answer: 'Two days.', citations: [] }).success,
    ).toBe(false);
    expect(
      modelAnswer.safeParse({
        kind: 'answer',
        answer: 'Two days.',
        citations: [{ documentId: id, chunkId: id }],
      }).success,
    ).toBe(true);
  });
  it('permits an explicit insufficient-knowledge result without inventing sources', () => {
    expect(
      modelAnswer.safeParse({
        kind: 'insufficient',
        answer: 'No accessible source answers this.',
        citations: [],
      }).success,
    ).toBe(true);
  });
});
