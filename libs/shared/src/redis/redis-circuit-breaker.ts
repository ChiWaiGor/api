export class RedisCircuitOpenError extends Error {
  constructor() {
    super('Redis circuit breaker is open');
    this.name = 'RedisCircuitOpenError';
  }
}

export type RedisCircuitState = 'closed' | 'open' | 'half-open';

export class RedisCircuitBreaker {
  private failures = 0;
  private state: RedisCircuitState = 'closed';
  private nextAttemptAt = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly resetTimeoutMs = 30_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttemptAt) {
        throw new RedisCircuitOpenError();
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getState(): RedisCircuitState {
    return this.state;
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private recordFailure(): void {
    if (this.state === 'half-open') {
      this.trip();
      return;
    }

    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = 'open';
    this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
  }
}
