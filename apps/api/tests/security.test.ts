import { describe, expect, it } from 'vitest';
import { RateLimit, TurnAdmission } from '../src/security.js';

describe('bounded local admission', () => {
  it('limits each actor to one request and refuses a third concurrent actor', () => {
    const guard = new TurnAdmission();
    const first = guard.acquire('alice');
    expect(() => guard.acquire('alice')).toThrow('BUSY');
    const second = guard.acquire('bob');
    expect(() => guard.acquire('charlie')).toThrow('BUSY');
    first();
    const third = guard.acquire('charlie');
    second();
    third();
  });
  it('does not permit an expired window to remain exhausted', () => {
    let now = 0;
    const limiter = new RateLimit(() => now);
    expect(limiter.consume('actor', 2)).toBe(true);
    expect(limiter.consume('actor', 2)).toBe(true);
    expect(limiter.consume('actor', 2)).toBe(false);
    now = 60001;
    expect(limiter.consume('actor', 2)).toBe(true);
  });
});
