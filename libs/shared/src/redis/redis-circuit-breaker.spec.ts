import {
  RedisCircuitBreaker,
  RedisCircuitOpenError,
} from './redis-circuit-breaker';

describe('RedisCircuitBreaker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes through successful calls while closed', async () => {
    const breaker = new RedisCircuitBreaker(2, 1000);
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('opens after failure threshold and rejects without calling fn', async () => {
    const breaker = new RedisCircuitBreaker(2, 1000);
    const fn = jest.fn().mockRejectedValue(new Error('redis down'));

    await expect(breaker.execute(fn)).rejects.toThrow('redis down');
    await expect(breaker.execute(fn)).rejects.toThrow('redis down');
    expect(breaker.getState()).toBe('open');
    expect(fn).toHaveBeenCalledTimes(2);

    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(
      RedisCircuitOpenError,
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('half-opens after reset timeout and closes on success', async () => {
    const breaker = new RedisCircuitBreaker(1, 1000);
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce('ok');

    await expect(breaker.execute(fn)).rejects.toThrow('redis down');
    expect(breaker.getState()).toBe('open');

    jest.advanceTimersByTime(1000);

    await expect(breaker.execute(fn)).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reopens when half-open probe fails', async () => {
    const breaker = new RedisCircuitBreaker(1, 1000);
    const fn = jest.fn().mockRejectedValue(new Error('still down'));

    await expect(breaker.execute(fn)).rejects.toThrow('still down');
    jest.advanceTimersByTime(1000);
    await expect(breaker.execute(fn)).rejects.toThrow('still down');
    expect(breaker.getState()).toBe('open');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
