import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';
import {
  recordRedisCircuitState,
  recordRedisOperationError,
} from '../observability/metrics.util';
import { RedisCircuitBreaker } from './redis-circuit-breaker';
import { buildRedisOptions } from './redis-options';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private readonly circuitBreaker = new RedisCircuitBreaker();

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit() {
    this.client = new Redis(
      buildRedisOptions(this.config, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      }),
    );

    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
    recordRedisCircuitState(this.circuitBreaker.getState());
  }

  async onModuleDestroy() {
    if (this.client?.status === 'ready' || this.client?.status === 'connect') {
      await this.client.quit();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async connect(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async ping(): Promise<string> {
    await this.connect();
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.execute(() => this.client.get(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.execute(async () => {
      await this.client.set(key, value);
    });
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.execute(async () => {
      await this.client.setex(key, ttlSeconds, value);
    });
  }

  async del(...keys: string[]): Promise<void> {
    await this.execute(async () => {
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    });
  }

  /**
   * Atomically increments a counter and (on first increment) sets a TTL window.
   * Returns the new counter value. Used for brute-force/lockout tracking.
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    return this.execute(async () => {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.execute(async () => (await this.client.exists(key)) === 1);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.setex(key, ttlSeconds, serialized);
    } else {
      await this.set(key, serialized);
    }
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.connect();
    try {
      const result = await this.circuitBreaker.execute(fn);
      recordRedisCircuitState(this.circuitBreaker.getState());
      return result;
    } catch (error) {
      recordRedisOperationError();
      recordRedisCircuitState(this.circuitBreaker.getState());
      throw error;
    }
  }
}
