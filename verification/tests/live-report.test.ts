import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { removeOwnedTemporaryDirectory } from '../owned-temporary.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { writeLiveReport } from '../live-report.js';
import type { LiveRecord } from '../live-report.js';

const temporary: string[] = [];
const provenance = {
  sourceRevision: 'a'.repeat(40),
  sourceTreeSha256: 'b'.repeat(64),
  workingTreeDirty: false,
  corpusSha256: 'c'.repeat(64),
  embeddingManifestSha256: 'd'.repeat(64),
  node: '24.14.0',
  python: '3.13.1',
  mastra: '1.84.0',
  googleAdapter: '4.0.122',
};
function root() {
  const path = mkdtempSync(join(tmpdir(), 'cleardesk-live-report-'));
  temporary.push(path);
  mkdirSync(join(path, 'verification'));
  writeFileSync(
    join(path, 'verification/live-cases.json'),
    JSON.stringify([{ id: 'L01', question: 'Fixed synthetic question', purpose: 'Test fixture' }]),
  );
  return path;
}
const record = (): LiveRecord => ({
  id: 'L01',
  status: 'PASS',
  actualStatus: 'ANSWERED',
  modelId: 'gemini-3.5-flash-lite',
  modelVersion: 'gemini-3.5-flash-lite',
  checks: {
    expectedState: true,
    expectedConcepts: true,
    expectedSource: true,
    noRestrictedMarkers: true,
    observedLiveModel: true,
  },
  generationRequests: 1,
  answerSha256: 'e'.repeat(64),
  observations: [
    {
      httpStatus: 200,
      modelVersion: 'gemini-3.5-flash-lite',
      inputTokens: 10,
      outputTokens: 5,
      providerErrorCode: null,
    },
  ],
  errorCode: null,
});
afterEach(() => temporary.splice(0).forEach(removeOwnedTemporaryDirectory));

it('rejects a supposed live PASS with no actual-response metadata or a fixture model version', () => {
  const path = root();
  expect(() =>
    writeLiveReport(path, {
      scope: 'smoke',
      provenance,
      budgetBefore: 0,
      budgetAfter: 1,
      records: [{ ...record(), observations: [] }],
    }),
  ).toThrow();
  expect(() =>
    writeLiveReport(path, {
      scope: 'smoke',
      provenance,
      budgetBefore: 0,
      budgetAfter: 1,
      records: [{ ...record(), modelVersion: 'synthetic-fixture' }],
    }),
  ).toThrow();
});
it('preserves missing and failed live observations instead of substituting a fixture', () => {
  const path = root();
  expect(
    writeLiveReport(path, {
      scope: 'smoke',
      provenance,
      budgetBefore: 0,
      budgetAfter: 0,
      records: [],
    }).status,
  ).toBe('INCOMPLETE');
  const failed: LiveRecord = {
    ...record(),
    status: 'ERROR',
    actualStatus: null,
    modelId: null,
    modelVersion: null,
    errorCode: 'PROVIDER_UNAVAILABLE',
    checks: {
      expectedState: false,
      expectedConcepts: false,
      expectedSource: false,
      noRestrictedMarkers: false,
      observedLiveModel: false,
    },
    answerSha256: null,
    observations: [
      {
        httpStatus: 429,
        modelVersion: null,
        inputTokens: null,
        outputTokens: null,
        providerErrorCode: 'RESOURCE_EXHAUSTED',
      },
    ],
  };
  const result = writeLiveReport(path, {
    scope: 'smoke',
    provenance,
    budgetBefore: 0,
    budgetAfter: 1,
    records: [failed],
  });
  expect(result.status).toBe('ERROR');
  expect(JSON.parse(readFileSync(join(result.directory, 'report.json'), 'utf8')).kind).toBe(
    'live-gemini',
  );
});
it('rejects budget mismatches and credential/raw-content fields', () => {
  const path = root();
  expect(() =>
    writeLiveReport(path, {
      scope: 'smoke',
      provenance,
      budgetBefore: 0,
      budgetAfter: 2,
      records: [record()],
    }),
  ).toThrow('LIVE_BUDGET_MISMATCH');
  expect(() =>
    writeLiveReport(path, {
      scope: 'smoke',
      provenance: { ...provenance, apiKey: 'not admitted' },
      budgetBefore: 0,
      budgetAfter: 1,
      records: [record()],
    }),
  ).toThrow();
});
