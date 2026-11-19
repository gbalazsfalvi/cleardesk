import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LEDGER_ABSENT, applicationAttempts, ledgerDigest } from '../ledger-observation.js';
import { removeOwnedTemporaryDirectory } from '../owned-temporary.js';

const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), 'cleardesk-ledger-'));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) removeOwnedTemporaryDirectory(directory);
});

it('observes a fresh install without ledgers as zero attempts and an explicit absent digest', () => {
  const directory = temporary();
  expect(applicationAttempts(join(directory, 'application-usage.json'))).toBe(0);
  expect(ledgerDigest(join(directory, 'generation-budget.json'))).toBe(LEDGER_ABSENT);
});

it('detects a ledger that appears or grows during an exercise', () => {
  const directory = temporary();
  const usage = join(directory, 'application-usage.json');
  const budget = join(directory, 'generation-budget.json');
  const before = { attempts: applicationAttempts(usage), ledger: ledgerDigest(budget) };
  writeFileSync(usage, JSON.stringify({ limit: null, attempts: [{ id: 'synthetic' }] }));
  writeFileSync(budget, JSON.stringify({ limit: 12, attempts: [] }));
  expect(applicationAttempts(usage) - before.attempts).toBe(1);
  expect(ledgerDigest(budget)).not.toBe(before.ledger);
  expect(ledgerDigest(budget)).toMatch(/^[0-9a-f]{64}$/);
});

it('rejects a malformed application ledger instead of reading it as zero', () => {
  const directory = temporary();
  const usage = join(directory, 'application-usage.json');
  writeFileSync(usage, JSON.stringify({ limit: null }));
  expect(() => applicationAttempts(usage)).toThrow('APPLICATION_LEDGER_INVALID');
});
