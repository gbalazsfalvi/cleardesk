import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stateDirectory } from '../../apps/api/src/state.js';
import { stateDirectory as lifecycleStateDirectory } from '../../scripts/state.mjs';

const root = join('C:', 'synthetic', 'cleardesk');
const implementations = [stateDirectory, lifecycleStateDirectory];

it('keeps the owner state in .local when no isolated state is requested', () => {
  for (const resolve of implementations) {
    expect(resolve(root, undefined)).toBe(join(root, '.local'));
    expect(resolve(root, '')).toBe(join(root, '.local'));
  }
});

it('maps an acceptance state name to its own directory under .local/acceptance', () => {
  for (const resolve of implementations) {
    expect(resolve(root, '.local/acceptance/2026-11-19T09-00-00-000Z-a1b2c3')).toBe(
      join(root, '.local', 'acceptance', '2026-11-19T09-00-00-000Z-a1b2c3'),
    );
    expect(resolve(root, '.local\\acceptance\\run-1')).toBe(
      join(root, '.local', 'acceptance', 'run-1'),
    );
  }
});

it('refuses any other location, nesting or traversal', () => {
  for (const resolve of implementations)
    for (const value of [
      '.local',
      '.local/private',
      '.local/acceptance/',
      '.local/acceptance/..',
      '.local/acceptance/../private',
      '.local/acceptance/a/b',
      '.local/acceptance/.hidden',
      '/tmp/cleardesk',
      'C:/Users/example/state',
      'docs/evidence',
    ])
      expect(() => resolve(root, value), value).toThrow('STATE_DIRECTORY_INVALID');
});
