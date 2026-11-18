import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { KnowledgeClient } from '../src/data-client.js';

it('preserves an exhausted verification allowance as its own history outcome', async () => {
  const workspace = '00000000-0000-4000-8000-000000000001';
  const conversation = '00000000-0000-4000-8000-000000000002';
  const turn = '00000000-0000-4000-8000-000000000003';
  let savedStatus = '';
  const client = {
    async request(path: string, _token: string, body?: { status?: string }) {
      if (path === '/v1/csrf' || path.endsWith('/check')) return {};
      if (path === '/v1/session') return { authenticated: true, actor: { id: 'owner' } };
      if (path.endsWith('/turns')) return { isNew: true, turnId: turn, history: [] };
      if (path.endsWith('/search')) return { chunks: [] };
      if (path.endsWith('/fail')) savedStatus = body?.status ?? '';
      return { turnId: turn, status: savedStatus, answer: null, sources: [] };
    },
  } as unknown as KnowledgeClient;
  const app = createApp({
    client,
    mode: 'live',
    providerConfigured: true,
    origins: ['http://127.0.0.1:4280'],
    runner: {
      run: async () => {
        throw new Error('BUDGET_EXHAUSTED');
      },
    },
  });
  const response = await app.request(
    `http://127.0.0.1:4280/api/workspaces/${workspace}/conversations/${conversation}/turns`,
    {
      method: 'POST',
      headers: {
        host: '127.0.0.1:4280',
        origin: 'http://127.0.0.1:4280',
        'content-type': 'application/json',
        cookie: 'cleardesk_session=synthetic',
        'x-csrf-token': 'synthetic',
      },
      body: JSON.stringify({
        question: 'Synthetic question',
        requestKey: '00000000-0000-4000-8000-000000000004',
      }),
    },
  );
  expect((await response.json()).code).toBe('BUDGET_EXHAUSTED');
  expect(savedStatus).toBe('BUDGET_EXHAUSTED');
});
