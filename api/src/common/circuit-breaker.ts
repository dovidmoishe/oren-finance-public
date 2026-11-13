import type { Clock } from './rate-limiter';

/**
 * Minimal circuit breaker: once tripped, `isOpen` stays true until the
 * cool-down passes. Consecutive soft failures trip it automatically.
 */
export class CircuitBreaker {
  private openUntil = 0;
  private consecutiveFailures = 0;
  private reason?: string;

  constructor(
    private readonly failureThreshold: number,
    private readonly failureCooldownMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  get openReason(): string | undefined {
    return this.isOpen() ? this.reason : undefined;
  }

  get openForMs(): number {
    return Math.max(0, this.openUntil - this.now());
  }

  trip(cooldownMs: number, reason: string): void {
    const until = this.now() + Math.max(0, cooldownMs);
    if (until > this.openUntil) {
      this.openUntil = until;
      this.reason = reason;
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(reason: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.consecutiveFailures = 0;
      this.trip(this.failureCooldownMs, reason);
    }
  }
}
