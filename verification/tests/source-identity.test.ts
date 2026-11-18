import { expect, it } from 'vitest';
import { sourceFingerprint } from '../source-identity.js';

it('gives UTF-8 source the same identity with LF and CRLF line endings', () => {
  const lf = [{ path: 'source/example.ts', bytes: Buffer.from('export const value = 42;\n') }];
  const crlf = [{ path: 'source/example.ts', bytes: Buffer.from('export const value = 42;\r\n') }];
  expect(sourceFingerprint(lf)).toBe(sourceFingerprint(crlf));
});
it('still detects a changed source value and filename', () => {
  const original = sourceFingerprint([{ path: 'source/a.py', bytes: Buffer.from('value = 1\n') }]);
  expect(sourceFingerprint([{ path: 'source/a.py', bytes: Buffer.from('value = 2\n') }])).not.toBe(
    original,
  );
  expect(sourceFingerprint([{ path: 'source/b.py', bytes: Buffer.from('value = 1\n') }])).not.toBe(
    original,
  );
});
it('hashes binary captures as exact bytes without newline rewriting', () => {
  const first = sourceFingerprint([{ path: 'public/example.png', bytes: Buffer.from([13, 10]) }]);
  expect(sourceFingerprint([{ path: 'public/example.png', bytes: Buffer.from([10]) }])).not.toBe(
    first,
  );
});
it('refuses malformed UTF-8 in a declared source-text file', () => {
  expect(() => sourceFingerprint([{ path: 'source/bad.ts', bytes: Buffer.from([255]) }])).toThrow(
    'SOURCE_TEXT_ENCODING_INVALID',
  );
});
