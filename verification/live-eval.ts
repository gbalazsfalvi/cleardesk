/** The only automated paid evaluation entry: synthetic questions, counted transport, no fallback. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createApp } from '../apps/api/src/app.js';
import { KnowledgeClient } from '../apps/api/src/data-client.js';
import { mastraRunner } from '../apps/api/src/ai/mastra-runner.js';
import { ProviderBudget } from '../apps/api/src/ai/provider-budget.js';
import type { ProviderObservation } from '../apps/api/src/ai/provider-budget.js';
import { provenance } from './report.js';
import { writeLiveReport } from './live-report.js';
import type { LiveRecord } from './live-report.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = JSON.parse(readFileSync(join(root, '.local/private/runtime.json'), 'utf8')) as {
  serviceKey: string;
};
const demo = JSON.parse(readFileSync(join(root, '.local/private/demo-accounts.json'), 'utf8')) as {
  accounts: { username: string; password: string }[];
  workspaces: Record<string, string>;
  documents: Record<string, string>;
};
const key = readFileSync(join(root, '.env.local'), 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('GOOGLE_GENERATIVE_AI_API_KEY='))
  ?.slice('GOOGLE_GENERATIVE_AI_API_KEY='.length)
  .trim();
if (!key) throw new Error('PROVIDER_KEY_REQUIRED');
const cases = z
  .array(
    z
      .object({
        id: z.string(),
        account: z.string(),
        workspace: z.string(),
        question: z.string().max(2000),
        expectedStatus: z.enum(['ANSWERED', 'INSUFFICIENT_KNOWLEDGE']),
        expectedSource: z.string().nullable(),
        requiredConcepts: z.array(z.string()),
        purpose: z.string(),
      })
      .strict(),
  )
  .parse(JSON.parse(readFileSync(join(root, 'verification/live-cases.json'), 'utf8')));
const scope = process.argv.includes('--smoke') ? 'smoke' : 'frozen-suite';
const selected = scope === 'smoke' ? cases.slice(0, 1) : cases;
const budget = new ProviderBudget(join(root, '.local/private/generation-budget.json'), 12);
const budgetBefore = budget.snapshot().spent;
const records: LiveRecord[] = [];
let providerBlocked = false;

for (const item of selected) {
  const checks = {
    expectedState: false,
    expectedConcepts: false,
    expectedSource: false,
    noRestrictedMarkers: false,
    observedLiveModel: false,
  };
  const record: LiveRecord = {
    id: item.id,
    status: 'INCOMPLETE',
    actualStatus: null,
    modelId: null,
    modelVersion: null,
    checks,
    generationRequests: 0,
    answerSha256: null,
    observations: [],
    errorCode: null,
  };
  records.push(record);
  // Keep two generation attempts available for the later actual-browser smoke.
  if (providerBlocked || budget.snapshot().remaining < 4) {
    record.errorCode = 'LIVE_ALLOWANCE_RESERVED';
    continue;
  }
  const before = budget.snapshot().spent;
  const observations: ProviderObservation[] = [];
  try {
    const app = createApp({
      client: new KnowledgeClient('http://127.0.0.1:4281', runtime.serviceKey),
      runner: mastraRunner(key, budget, fetch, (value) => observations.push(value)),
      mode: 'live',
      providerConfigured: true,
      origins: ['http://127.0.0.1:4280'],
    });
    let cookie = '';
    let csrf = '';
    const call = async (path: string, body?: unknown) => {
      const response = await app.request('http://127.0.0.1:4280/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          host: '127.0.0.1:4280',
          cookie,
          ...(body === undefined
            ? {}
            : {
                origin: 'http://127.0.0.1:4280',
                'content-type': 'application/json',
                'x-csrf-token': csrf,
              }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const nextCookie = response.headers.get('set-cookie');
      if (nextCookie) cookie = nextCookie.split(';')[0]!;
      return { status: response.status, body: (await response.json()) as any };
    };
    const initial = await call('/session');
    csrf = initial.body.csrfToken;
    const account = demo.accounts.find((value) => value.username === item.account)!;
    const signed = await call('/session', {
      username: account.username,
      password: account.password,
    });
    if (signed.status !== 200) throw new Error('SCENARIO_ERROR');
    csrf = signed.body.csrfToken;
    const base = '/workspaces/' + demo.workspaces[item.workspace] + '/conversations';
    const conversation = await call(base, { title: 'Gemini evaluation · ' + item.id });
    if (conversation.status !== 201) throw new Error('SCENARIO_ERROR');
    const response = await call(base + '/' + conversation.body.conversation.id + '/turns', {
      question: item.question,
      requestKey: randomUUID(),
    });
    const value = response.body;
    record.actualStatus = typeof value.status === 'string' ? value.status : null;
    record.modelId = value.model?.id ?? null;
    record.modelVersion = value.model?.version ?? null;
    const text = typeof value.answer === 'string' ? value.answer : '';
    record.answerSha256 = text ? createHash('sha256').update(text).digest('hex') : null;
    if (response.status !== 200) {
      record.status = 'ERROR';
      record.errorCode = ['BUDGET_EXHAUSTED', 'UNVERIFIED_RESPONSE', 'ACCESS_CHANGED'].includes(
        value.code,
      )
        ? value.code
        : 'PROVIDER_UNAVAILABLE';
      providerBlocked = true;
    } else {
      checks.expectedState = value.status === item.expectedStatus;
      checks.expectedConcepts = item.requiredConcepts.every((pattern) =>
        new RegExp(pattern, 'i').test(text),
      );
      checks.expectedSource =
        item.expectedSource === null
          ? value.sources.length === 0
          : value.sources.some(
              (source: { documentId: string }) =>
                source.documentId === demo.documents[item.expectedSource!],
            );
      checks.noRestrictedMarkers =
        item.account === 'riley'
          ? !text.includes('HARBOR-CANARY') && !text.includes('HARBOR-HR-CANARY')
          : !['HARBOR-CANARY-QUARTZ-91', 'HARBOR-HR-CANARY-AMBER-42', 'HR-CANARY-ORCHID-73'].some(
              (marker) => text.includes(marker),
            );
      checks.observedLiveModel =
        value.model?.mode === 'live' &&
        value.model.id === 'gemini-3.5-flash-lite' &&
        observations.some(
          (observation) => observation.httpStatus === 200 && observation.modelVersion !== null,
        );
      record.status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
    }
    await call('/logout', {});
  } catch {
    record.status = 'ERROR';
    record.errorCode = 'SCENARIO_ERROR';
    providerBlocked = true;
  } finally {
    record.generationRequests = budget.snapshot().spent - before;
    record.observations = observations;
    console.log(
      JSON.stringify({
        case: item.id,
        status: record.status,
        generationRequests: record.generationRequests,
        modelVersion: record.modelVersion,
        providerStatuses: observations.map((value) => value.httpStatus),
        providerErrorCodes: observations.map((value) => value.providerErrorCode),
      }),
    );
  }
}
const result = writeLiveReport(root, {
  scope,
  provenance: provenance(root),
  budgetBefore,
  budgetAfter: budget.snapshot().spent,
  records,
});
console.log(
  JSON.stringify({
    kind: 'live-gemini',
    scope,
    status: result.status,
    generatedAt: result.generatedAt,
    spent: budget.snapshot().spent,
    limit: 12,
  }),
);
if (result.status !== 'PASS') process.exitCode = 1;
