import { expect, it } from 'vitest';
import { countLabel } from '../src/format.js';

it('uses the singular noun phrase for exactly one accessible item', () => {
  expect(countLabel(1, 'accessible source')).toBe('1 accessible source');
  expect(countLabel(1, 'accessible document')).toBe('1 accessible document');
});

it('uses the plural noun phrase for zero and several items', () => {
  expect(countLabel(0, 'accessible source')).toBe('0 accessible sources');
  expect(countLabel(4, 'accessible document')).toBe('4 accessible documents');
  expect(countLabel(2, 'entry', 'entries')).toBe('2 entries');
});
