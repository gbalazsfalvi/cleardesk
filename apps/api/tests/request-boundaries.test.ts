import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { LIMITS } from '@cleardesk/contracts';
import { createApp } from '../src/app.js';
import { DataError } from '../src/data-client.js';
import type { KnowledgeClient } from '../src/data-client.js';

const origin = 'http://127.0.0.1:4280';
const turnPath =
  '/api/workspaces/00000000-0000-4000-8000-000000000001/' +
  'conversations/00000000-0000-4000-8000-000000000002/turns';
const question = JSON.stringify({
  question: 'Synthetic request boundary probe.',
  requestKey: '00000000-0000-4000-8000-000000000003',
});

/** A nonexistent conversation makes accepted input observable without running any model. */
function fixture() {
  const calls: string[] = [];
  const client = {
    async request(path: string, _token: string, body?: { csrfToken?: string }) {
      calls.push(path);
      if (path === '/v1/csrf') {
        if (!body?.csrfToken) throw new DataError('INVALID_INPUT', 400);
        return { valid: true };
      }
      if (path === '/v1/session')
        return { authenticated: true, actor: { id: 'synthetic-actor' }, workspaces: [] };
      throw new DataError('NOT_FOUND', 404);
    },
  } as unknown as KnowledgeClient;
  const app = createApp({
    client,
    mode: 'fixture',
    providerConfigured: false,
    origins: [origin],
    runner: {
      async run() {
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    },
  });
  return { app, calls };
}

/** Send real HTTP framing to a short-lived loopback listener, not a fabricated Request. */
async function wireRequest(app: ReturnType<typeof createApp>, body: string, chunked: boolean) {
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  try {
    return await new Promise<{ status: number; code: string }>((resolve, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: (server.address() as AddressInfo).port,
          path: turnPath,
          method: 'POST',
          headers: {
            host: '127.0.0.1:4280',
            origin,
            'content-type': 'application/json',
            cookie: 'cleardesk_session=synthetic-session',
            'x-csrf-token': 'synthetic-csrf',
            ...(chunked
              ? { 'transfer-encoding': 'chunked' }
              : { 'content-length': Buffer.byteLength(body) }),
          },
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (part) => (text += part));
          response.on('error', reject);
          response.on('end', () =>
            resolve({ status: response.statusCode!, code: JSON.parse(text).code }),
          );
        },
      );
      request.setTimeout(3000, () => request.destroy(new Error('TEST_REQUEST_TIMEOUT')));
      request.on('error', reject);
      request.write(body.slice(0, 100));
      request.end(body.slice(100));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it.each([true, false])(
  'rejects an oversized chat before private work with chunked=%s',
  async (chunked) => {
    const { app, calls } = fixture();
    const oversized = question.padEnd(LIMITS.chatRequestBytes + 1, ' ');
    const response = await wireRequest(app, oversized, chunked);
    expect(response).toEqual({ status: 413, code: 'BODY_TOO_LARGE' });
    expect(calls).toEqual([]);
  },
);

it.each([true, false])(
  'accepts a chat exactly at the byte limit with chunked=%s',
  async (chunked) => {
    const { app, calls } = fixture();
    const response = await wireRequest(app, question.padEnd(LIMITS.chatRequestBytes, ' '), chunked);
    expect(response).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(calls.some((path) => path.endsWith('/turns'))).toBe(true);
  },
);

it.each([undefined, '', '   '])(
  'rejects an absent or blank CSRF token before contacting the private service: %s',
  async (csrf) => {
    const { app, calls } = fixture();
    const response = await app.request(origin + '/api/logout', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4280',
        origin,
        'content-type': 'application/json',
        cookie: 'cleardesk_session=synthetic-session',
        ...(csrf === undefined ? {} : { 'x-csrf-token': csrf }),
      },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('CSRF_REJECTED');
    expect(calls).toEqual([]);
  },
);
