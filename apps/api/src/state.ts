import { join } from 'node:path';

/**
 * Owned runtime state: the owner's `.local` by default, or exactly one isolated acceptance
 * directory `.local/acceptance/<name>`. Keep in step with scripts/state.mjs and
 * services/knowledge/cleardesk/state.py; verification/tests/state-directory.test.ts checks parity.
 */
const PREFIX = '.local/acceptance/';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function stateDirectory(root: string, value = process.env.CLEARDESK_STATE): string {
  if (!value) return join(root, '.local');
  const normalized = value.replaceAll('\\', '/');
  const name = normalized.startsWith(PREFIX) ? normalized.slice(PREFIX.length) : '';
  if (!NAME.test(name)) throw new Error('STATE_DIRECTORY_INVALID');
  return join(root, '.local', 'acceptance', name);
}

export const privateFile = (root: string, name: string) =>
  join(stateDirectory(root), 'private', name);
