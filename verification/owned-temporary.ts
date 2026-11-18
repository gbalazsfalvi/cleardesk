import { realpathSync, rmSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';

/** Check the resolved absolute target before recursive deletion, including on Windows. */
export function removeOwnedTemporaryDirectory(path: string): void {
  const target = realpathSync(path);
  const parent = realpathSync(tmpdir());
  if (dirname(target) !== parent || !basename(target).startsWith('cleardesk-'))
    throw new Error('OWNED_TEMPORARY_PATH_REQUIRED');
  rmSync(target, { recursive: true });
}
