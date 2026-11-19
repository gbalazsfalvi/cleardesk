import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { KnowledgeClient } from './data-client.js';
import { fixtureRunner } from './ai/fixture-runner.js';
import { mastraRunner } from './ai/mastra-runner.js';
import { applicationUsage } from './ai/provider-budget.js';
import { stateDirectory } from './state.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const privateState = join(stateDirectory(root), 'private');
const runtime = JSON.parse(readFileSync(join(privateState, 'runtime.json'), 'utf8')) as {
  serviceKey: string;
  mode: 'live' | 'fixture';
  instanceId: string;
};
if (!['fixture', 'live'].includes(runtime.mode)) throw new Error('MODEL_MODE_INVALID');
let apiKey = '';
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('GOOGLE_GENERATIVE_AI_API_KEY='))
      apiKey = line.slice(line.indexOf('=') + 1).trim();
  }
}
if (runtime.mode === 'live' && !apiKey) throw new Error('PROVIDER_KEY_REQUIRED');
const budget = applicationUsage(
  join(privateState, 'application-usage.json'),
  join(privateState, 'generation-budget.json'),
);
const app = createApp({
  client: new KnowledgeClient('http://127.0.0.1:4281', runtime.serviceKey),
  runner: runtime.mode === 'live' ? mastraRunner(apiKey, budget) : fixtureRunner,
  mode: runtime.mode,
  providerConfigured: Boolean(apiKey),
  instanceId: runtime.instanceId,
  origins: ['http://127.0.0.1:4280', 'http://127.0.0.1:4282'],
  peer: (context) => getConnInfo(context).remote.address ?? 'unknown',
});
const webRoot = join(root, 'apps/web/dist');
app.get('/assets/*', serveStatic({ root: webRoot }));
app.get('/licenses/*', serveStatic({ root: webRoot }));
app.get('/favicon.svg', serveStatic({ root: webRoot }));
app.get('/', serveStatic({ path: join(webRoot, 'index.html') }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 4280 });
server.on('listening', () =>
  console.log(
    JSON.stringify({
      app: 'ClearDesk',
      url: 'http://127.0.0.1:4280',
      mode: runtime.mode,
      version: '0.1.1',
    }),
  ),
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('uncaughtException', () => {
  console.error('ClearDesk stopped: an unexpected server error occurred.');
  stop();
});
process.on('unhandledRejection', () => {
  console.error('ClearDesk stopped: an unexpected asynchronous error occurred.');
  stop();
});
