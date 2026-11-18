import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { removeOwnedTemporaryDirectory } from '../owned-temporary.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';

const temporary: string[] = [];
const kinds = {
  security: 'deterministic-fixture',
  retrieval: 'actual-local-embedding-retrieval',
  live: 'live-gemini',
  'browser-live': 'live-gemini-browser',
};
function root() {
  const path = mkdtempSync(join(tmpdir(), 'cleardesk-export-'));
  temporary.push(path);
  mkdirSync(join(path, 'scripts'));
  mkdirSync(join(path, 'docs/images'), { recursive: true });
  writeFileSync(join(path, 'scripts/evidence.mjs'), readFileSync('scripts/evidence.mjs'));
  for (const [directory, kind] of Object.entries(kinds))
    run(path, directory, kind, 'PASS', '2026-11-18T10:00:00Z');
  return path;
}
function run(root: string, directory: string, kind: string, status: string, generatedAt: string) {
  const path = join(root, 'artifacts/runs', directory, generatedAt.replaceAll(':', '-'));
  mkdirSync(path, { recursive: true });
  const content = JSON.stringify({
    kind,
    status,
    generatedAt,
    ...(directory === 'live' ? { scope: 'frozen-suite' } : {}),
  });
  writeFileSync(join(path, 'report.json'), content);
  writeFileSync(
    join(path, 'SHA256SUMS'),
    createHash('sha256').update(content).digest('hex') + '  report.json\n',
  );
  return path;
}
const command = (root: string, action: string) =>
  spawnSync(process.execPath, [join(root, 'scripts/evidence.mjs'), action], { encoding: 'utf8' });
afterEach(() => temporary.splice(0).forEach(removeOwnedTemporaryDirectory));

it('exports the newest failure rather than cherry-picking the older passing run', () => {
  const path = root();
  run(path, 'security', kinds.security, 'FAIL', '2026-11-18T11:00:00Z');
  expect(command(path, 'export').status).toBe(1);
  const index = JSON.parse(readFileSync(join(path, 'docs/evidence/index.json'), 'utf8'));
  expect(
    index.artifacts.find((item: { directory: string }) => item.directory === 'security').status,
  ).toBe('FAIL');
});
it('detects changed exported bytes without repairing the recorded hashes', () => {
  const path = root();
  expect(command(path, 'export').status).toBe(0);
  writeFileSync(join(path, 'docs/evidence/security/report.json'), 'changed bytes');
  const checked = command(path, 'verify');
  expect(checked.status).toBe(1);
  expect(checked.stderr).toContain('EVIDENCE_HASH_MISMATCH');
});
it('refuses a source manifest that points outside its own run directory', () => {
  const path = root();
  const source = run(path, 'security', kinds.security, 'PASS', '2026-11-18T11:00:00Z');
  writeFileSync(join(source, 'SHA256SUMS'), 'a'.repeat(64) + '  ../outside.json\n');
  expect(command(path, 'export').stderr).toContain('EVIDENCE_MANIFEST_INVALID');
});
