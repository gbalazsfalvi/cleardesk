import { describe, expect, it } from 'vitest';
import { RateLimit, TurnAdmission } from '../src/security.js';
import { createApp } from '../src/app.js';
import { DataError } from '../src/data-client.js';
import type { KnowledgeClient } from '../src/data-client.js';

describe('bounded local admission', () => {
  it('does not let forged forwarding headers evade login admission', async () => {
    const client = {
      request: async (path: string) => {
        if (path === '/v1/csrf') return { valid: true };
        throw new DataError('INVALID_CREDENTIALS', 401);
      },
    } as unknown as KnowledgeClient;
    const app = createApp({
      client,
      mode: 'fixture',
      providerConfigured: false,
      origins: ['http://127.0.0.1:4280'],
      peer: () => '127.0.0.1',
      runner: {
        run: async () => {
          throw new Error('unused');
        },
      },
    });
    for (let index = 0; index <= 20; index++) {
      const result = await app.request('http://127.0.0.1:4280/api/session', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:4280',
          origin: 'http://127.0.0.1:4280',
          'content-type': 'application/json',
          cookie: 'cleardesk_session=synthetic-session',
          'x-csrf-token': 'synthetic-csrf',
          'x-forwarded-for': '192.0.2.' + index,
        },
        body: JSON.stringify({ username: 'missing', password: 'incorrect' }),
      });
      expect(result.status).toBe(index < 20 ? 401 : 429);
      if (index === 20) expect(result.headers.get('retry-after')).toBe('60');
    }
  });
  it('limits each actor to one request and refuses a third concurrent actor', () => {
    const guard = new TurnAdmission();
    const first = guard.acquire('alice');
    expect(() => guard.acquire('alice')).toThrow('BUSY');
    const second = guard.acquire('bob');
    expect(() => guard.acquire('charlie')).toThrow('BUSY');
    first();
    const third = guard.acquire('charlie');
    second();
    third();
  });
  it('does not permit an expired window to remain exhausted', () => {
    let now = 0;
    const limiter = new RateLimit(() => now);
    expect(limiter.consume('actor', 2)).toBe(true);
    expect(limiter.consume('actor', 2)).toBe(true);
    expect(limiter.consume('actor', 2)).toBe(false);
    now = 60001;
    expect(limiter.consume('actor', 2)).toBe(true);
  });
});
