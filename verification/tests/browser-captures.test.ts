import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { captureDirectory } from '../browser/captures.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

it('places browser captures inside the run directory', () => {
  expect(captureDirectory(root, 'artifacts/runs/browser/example-1')).toBe(
    resolve(root, 'artifacts/runs/browser/example-1/captures'),
  );
});

it('refuses capture locations outside ignored run output', () => {
  expect(() => captureDirectory(root, undefined)).toThrow('CLEARDESK_BROWSER_RUN');
  expect(() => captureDirectory(root, 'docs/images')).toThrow('artifacts/runs');
  expect(() => captureDirectory(root, 'artifacts/runs/../../docs')).toThrow('artifacts/runs');
});

it('keeps reviewed documentation images out of every browser journey', () => {
  // A run must never overwrite hash-bound evidence images; promotion is a reviewed manual step.
  for (const spec of ['product.spec.ts', 'live.spec.ts']) {
    const source = readFileSync(join(root, 'verification/browser', spec), 'utf8');
    expect(source).not.toMatch(/docs\/images/);
  }
});
