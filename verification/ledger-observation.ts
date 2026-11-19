import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Read-only ledger observations for checks that must prove no generation was dispatched.
 * A fresh install has no ledger until its first live request, so absence is a valid state.
 * It is reported explicitly and compared before/after, never treated as an empty passing file.
 */
export const LEDGER_ABSENT = 'ABSENT' as const;

export function applicationAttempts(path: string): number {
  if (!existsSync(path)) return 0;
  const attempts = (JSON.parse(readFileSync(path, 'utf8')) as { attempts?: unknown }).attempts;
  if (!Array.isArray(attempts)) throw new Error('APPLICATION_LEDGER_INVALID');
  return attempts.length;
}

export function ledgerDigest(path: string): string {
  if (!existsSync(path)) return LEDGER_ABSENT;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
