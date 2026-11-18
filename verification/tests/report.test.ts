import { describe, expect, it } from 'vitest';
import { buildReport, escapeHtml, CASES } from '../report.js';

const provenance = {
  sourceRevision: 'a'.repeat(40),
  sourceTreeSha256: 'b'.repeat(64),
  workingTreeDirty: true,
  corpusSha256: 'c'.repeat(64),
  embeddingManifestSha256: 'd'.repeat(64),
  node: '24.14.0',
  python: '3.13.1',
  mastra: '1.84.0',
  googleAdapter: '4.0.122',
};
const records = () =>
  CASES.map((item) => ({
    id: item.id,
    assertions: Object.fromEntries(item.checks.map((key) => [key, true])),
  }));
const prerequisites = {
  dataReady: true,
  syntheticCorpus: true,
  fixtureOnly: true,
  browserAvailable: true,
};

describe('evidence admission', () => {
  it('requires every case and every named assertion before reporting PASS', () => {
    expect(buildReport({ provenance, prerequisites, records: records() }).status).toBe('PASS');
    expect(buildReport({ provenance, prerequisites, records: records().slice(1) }).status).toBe(
      'INCOMPLETE',
    );
    const partial = records();
    partial[0]!.assertions = {};
    expect(buildReport({ provenance, prerequisites, records: partial }).cases[0]!.status).toBe(
      'INCOMPLETE',
    );
  });
  it('preserves failed prerequisites, assertions and scenario errors', () => {
    expect(
      buildReport({
        provenance,
        prerequisites: { ...prerequisites, dataReady: false },
        records: records(),
      }).status,
    ).toBe('INCOMPLETE');
    const failed = records();
    failed[0]!.assertions[CASES[0]!.checks[0]!] = false;
    expect(buildReport({ provenance, prerequisites, records: failed }).status).toBe('FAIL');
    const errored = records().map((item, index) =>
      index === 0 ? { ...item, errorCode: 'SCENARIO_ERROR' } : item,
    );
    expect(buildReport({ provenance, prerequisites, records: errored }).status).toBe('ERROR');
  });
  it('rejects duplicate assertions, raw content/credential fields and live/fixture conflation', () => {
    expect(() =>
      buildReport({ provenance, prerequisites, records: [...records(), records()[0]!] }),
    ).toThrow();
    expect(() =>
      buildReport({
        provenance: { ...provenance, apiKey: 'forbidden' },
        prerequisites,
        records: records(),
      }),
    ).toThrow();
    expect(() =>
      buildReport({ provenance, prerequisites, records: records(), rawPrompt: 'not admitted' }),
    ).toThrow();
    expect(() =>
      buildReport({ provenance, prerequisites, records: records(), model: 'gemini' }),
    ).toThrow();
  });
  it('escapes even script terminators and attribute syntax in standalone HTML', () => {
    expect(escapeHtml('</script><img src=x onerror="bad">')).toBe(
      '&lt;/script&gt;&lt;img src=x onerror=&quot;bad&quot;&gt;',
    );
  });
});
