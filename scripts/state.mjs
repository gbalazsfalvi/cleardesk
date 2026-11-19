import { join } from 'node:path';

/**
 * Owned runtime state for plain Node scripts. Mirrors apps/api/src/state.ts and
 * services/knowledge/cleardesk/state.py; verification/tests/state-directory.test.ts checks parity.
 */
const PREFIX = '.local/acceptance/';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function stateDirectory(root, value = process.env.CLEARDESK_STATE) {
  if (!value) return join(root, '.local');
  const normalized = value.replaceAll('\\', '/');
  const name = normalized.startsWith(PREFIX) ? normalized.slice(PREFIX.length) : '';
  if (!NAME.test(name)) throw new Error('STATE_DIRECTORY_INVALID');
  return join(root, '.local', 'acceptance', name);
}
