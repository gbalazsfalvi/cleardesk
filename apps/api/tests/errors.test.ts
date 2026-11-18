import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { KnowledgeClient } from '../src/data-client.js';

it.each(['constructor', 'DO-NOT-EXPOSE-RAW-PROVIDER-MESSAGE'])(
  'returns only an owned safe error code for %s',
  async (message) => {
    const client = {
      request: async () => {
        throw new Error(message);
      },
    } as unknown as KnowledgeClient;
    const app = createApp({
      client,
      runner: {
        run: async () => {
          throw new Error('unused');
        },
      },
      mode: 'fixture',
      providerConfigured: false,
      origins: ['http://127.0.0.1:4280'],
    });
    const response = await app.request('http://127.0.0.1:4280/api/status');
    expect(response.status).toBe(503);
    const value = await response.json();
    expect(value.code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(value)).not.toContain(message);
  },
);
