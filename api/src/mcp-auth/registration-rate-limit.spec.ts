import { createRegistrationRateLimit } from './registration-rate-limit';

describe('MCP dynamic registration limit', () => {
  it('bounds attempts per address and permits them after the window passes', () => {
    const retryAfter = createRegistrationRateLimit({
      perAddress: 2,
      global: 100,
      windowMs: 60_000,
    });
    expect(retryAfter('203.0.113.1', 10_000)).toBe(0);
    expect(retryAfter('203.0.113.1', 10_001)).toBe(0);
    expect(retryAfter('203.0.113.1', 10_002)).toBe(60);
    expect(retryAfter('203.0.113.1', 70_000)).toBe(0);
  });

  it('keeps other addresses able to register while one is blocked', () => {
    const retryAfter = createRegistrationRateLimit({
      perAddress: 2,
      global: 100,
      windowMs: 60_000,
    });
    for (let i = 0; i < 50; i++) retryAfter('198.51.100.7', 1_000 + i);
    expect(retryAfter('198.51.100.7', 2_000)).toBeGreaterThan(0);
    expect(retryAfter('203.0.113.9', 2_000)).toBe(0);
  });

  it('still enforces a global ceiling across addresses', () => {
    const retryAfter = createRegistrationRateLimit({
      perAddress: 5,
      global: 3,
      windowMs: 60_000,
    });
    expect(retryAfter('a', 1)).toBe(0);
    expect(retryAfter('b', 2)).toBe(0);
    expect(retryAfter('c', 3)).toBe(0);
    expect(retryAfter('d', 4)).toBeGreaterThan(0);
  });
});
