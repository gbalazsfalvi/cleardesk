import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { searchInput } from '@cleardesk/contracts';
import { createApp, searchQuery } from '../src/app.js';
import type { KnowledgeClient } from '../src/data-client.js';

describe('opening search query', () => {
  it('trims surrounding whitespace to a usable query', () => {
    expect(searchQuery('  hybrid work policy  ')).toBe('hybrid work policy');
    // Leading whitespace longer than the 500-character slice must not empty the query.
    expect(searchQuery(' '.repeat(600) + 'expenses')).toBe('expenses');
  });
  it('never emits a lone surrogate or an over-long query that the tool schema rejects', () => {
    const query = searchQuery('a'.repeat(499) + '😀');
    expect(query.length).toBeLessThanOrEqual(500);
    for (const character of query) {
      const point = character.codePointAt(0) ?? 0;
      expect(point < 0xd800 || point > 0xdfff).toBe(true);
    }
    expect(() => searchInput.parse({ query })).not.toThrow();
  });
});

describe('chat admission key', () => {
  it('rate-limits chat per actor regardless of the workspace id casing', async () => {
    const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const conversation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const client = {
      request: async (path: string) => {
        if (path === '/v1/csrf') return { valid: true };
        if (path === '/v1/session')
          return {
            authenticated: true,
            csrfToken: 'csrf',
            actor: { id: 'actor-1', username: 'a', displayName: 'A' },
            workspaces: [],
            modelMode: 'fixture',
          };
        // The prepare call: an existing request key replays without running the model.
        return {
          isNew: false,
          turnId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          status: 'ANSWERED',
          answer: 'x',
          sources: [],
          model: { mode: 'fixture', id: null, version: null },
          requestId: 'r',
        };
      },
    } as unknown as KnowledgeClient;
    const app = createApp({
      client,
      mode: 'fixture',
      providerConfigured: false,
      origins: ['http://127.0.0.1:4280'],
      runner: {
        run: async () => {
          throw new Error('unused');
        },
      },
    });
    const post = (ws: string) =>
      app.request(
        `http://127.0.0.1:4280/api/workspaces/${ws}/conversations/${conversation}/turns`,
        {
          method: 'POST',
          headers: {
            host: '127.0.0.1:4280',
            origin: 'http://127.0.0.1:4280',
            'content-type': 'application/json',
            cookie: 'cleardesk_session=synthetic',
            'x-csrf-token': 'csrf',
          },
          body: JSON.stringify({ question: 'hi', requestKey: randomUUID() }),
        },
      );
    for (let index = 0; index < 6; index++) expect((await post(workspace)).status).toBe(200);
    // The seventh request within the minute is refused even when the workspace id is upper-cased.
    expect((await post(workspace.toUpperCase())).status).toBe(429);
  });
});
