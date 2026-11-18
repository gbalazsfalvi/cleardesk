import { existsSync, mkdirSync, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { removeOwnedTemporaryDirectory } from '../owned-temporary.js';

it('resolves and confines recursive cleanup to an owned ClearDesk temporary directory', () => {
  const owned = mkdtempSync(join(tmpdir(), 'cleardesk-cleanup-'));
  mkdirSync(join(owned, 'nested'));
  removeOwnedTemporaryDirectory(owned);
  expect(existsSync(owned)).toBe(false);
  const foreign = mkdtempSync(join(tmpdir(), 'unrelated-cleanup-fixture-'));
  try {
    expect(() => removeOwnedTemporaryDirectory(foreign)).toThrow('OWNED_TEMPORARY_PATH_REQUIRED');
    expect(existsSync(foreign)).toBe(true);
  } finally {
    rmdirSync(foreign);
  }
});
