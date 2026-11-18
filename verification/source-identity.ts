import { createHash } from 'node:crypto';
import { extname } from 'node:path';

/** Versioned source identity: text uses UTF-8/LF; binary artifacts retain exact bytes. */
export const SOURCE_HASH_METHOD = 'utf8-lf-v1' as const;
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.html',
  '.svg',
  '.py',
  '.sql',
  '.toml',
  '.in',
  '.lock',
  '.txt',
  '.md',
  '.yml',
  '.yaml',
]);

/** Git checkout newline conversion must not change otherwise identical source identity. */
export function sourceFingerprint(entries: readonly { path: string; bytes: Uint8Array }[]): string {
  const normalized = entries.map((entry) => ({ ...entry, path: entry.path.replaceAll('\\', '/') }));
  normalized.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const tree = createHash('sha256');
  let previous: string | undefined;
  for (const entry of normalized) {
    if (entry.path === previous) throw new Error('DUPLICATE_SOURCE_PATH');
    previous = entry.path;
    let bytes = entry.bytes;
    if (TEXT_EXTENSIONS.has(extname(entry.path).toLowerCase())) {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new Error('SOURCE_TEXT_ENCODING_INVALID');
      }
      bytes = Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8');
    }
    tree.update(entry.path + '\0');
    tree.update(bytes);
    tree.update('\0');
  }
  return tree.digest('hex');
}
