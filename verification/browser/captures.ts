import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Browser journeys write screenshots into their own ignored run directory.
 * Reviewed documentation images under docs/ are promoted deliberately, never overwritten by a run.
 */
export function captureDirectory(root: string, runDirectory: string | undefined): string {
  if (!runDirectory) throw new Error('CLEARDESK_BROWSER_RUN is not set; run through Playwright.');
  const runs = resolve(root, 'artifacts/runs');
  const directory = resolve(root, runDirectory, 'captures');
  const inside = relative(runs, directory);
  if (!inside || inside.startsWith('..') || isAbsolute(inside))
    throw new Error('Browser captures must stay under artifacts/runs.');
  return directory;
}

export function prepareCaptureDirectory(root: string): string {
  const directory = captureDirectory(root, process.env.CLEARDESK_BROWSER_RUN);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export const capturePath = (directory: string, name: string) => join(directory, name);
