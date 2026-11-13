import { SlidingWindowLimiter } from '../common/rate-limit';

/**
 * Bound public dynamic client registrations on the single API instance.
 * Each address gets a small allowance so one client cannot use up the shared
 * ceiling and lock everyone else out of connecting an agent.
 */
export function createRegistrationRateLimit(
  options: { perAddress?: number; global?: number; windowMs?: number } = {},
) {
  const windowMs = options.windowMs ?? 60 * 60_000;
  const perAddress = new SlidingWindowLimiter(
    options.perAddress ?? 10,
    windowMs,
  );
  const global = new SlidingWindowLimiter(options.global ?? 300, windowMs);
  return (address: string, now = Date.now()): number =>
    // Check the address first so a blocked address never consumes global room.
    perAddress.hit(address, now) || global.hit('all', now);
}
