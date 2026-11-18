import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { KnowledgeClient } from '../src/data-client.js';

it('returns a terminal cancellation state to the waiting owner instead of a provider failure', async () => {
  const workspace = '00000000-0000-4000-8000-000000000001';
  const conversation = '00000000-0000-4000-8000-000000000002';
  const turn = '00000000-0000-4000-8000-000000000003';
  let state = 'PENDING';
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const client = {
    async request(path: string) {
      if (path === '/v1/csrf') return { valid: true };
      if (path === '/v1/session')
        return {
          authenticated: true,
          actor: { id: 'owner' },
          workspaces: [{ id: workspace, name: 'Synthetic', role: 'MEMBER' }],
        };
      if (path.endsWith('/search')) return { chunks: [] };
      if (path.endsWith('/check')) return { revision: 1 };
      if (path.endsWith('/turns')) return { isNew: true, turnId: turn, history: [] };
      if (path.endsWith('/cancel')) state = 'CANCELLED';
      return {
        turnId: turn,
        status: state,
        answer: null,
        sources: [],
        model: { mode: 'fixture', id: 'cancellation-fixture', version: '1' },
      };
    },
  } as unknown as KnowledgeClient;
  const app = createApp({
    client,
    mode: 'fixture',
    providerConfigured: false,
    origins: ['http://127.0.0.1:4280'],
    runner: {
      run: async ({ signal }) =>
        new Promise((_, reject) => {
          started();
          signal.addEventListener('abort', () => reject(new Error('REQUEST_CANCELLED')), {
            once: true,
          });
        }),
    },
  });
  const headers = {
    host: '127.0.0.1:4280',
    origin: 'http://127.0.0.1:4280',
    'content-type': 'application/json',
    cookie: 'cleardesk_session=owner-token',
    'x-csrf-token': 'test-csrf',
  };
  const base = `/api/workspaces/${workspace}/conversations/${conversation}/turns`;
  const pending = app.request('http://127.0.0.1:4280' + base, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: 'Synthetic question',
      requestKey: '00000000-0000-4000-8000-000000000004',
    }),
  });
  await running;
  const cancelled = await app.request('http://127.0.0.1:4280' + base + '/' + turn + '/cancel', {
    method: 'POST',
    headers,
    body: '{}',
  });
  expect(cancelled.status).toBe(200);
  const completed = await pending;
  expect(completed.status).toBe(200);
  expect((await completed.json()).status).toBe('CANCELLED');
});
