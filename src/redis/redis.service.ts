import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { RedisCircuitBreaker } from './redis-circuit-breaker';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private readonly circuitBreaker = new RedisCircuitBreaker();

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit() {
    const host = this.config.get('REDIS_HOST', { infer: true });
    const port = this.config.get('REDIS_PORT', { infer: true });
    const password = this.config.get('REDIS_PASSWORD', { infer: true });
    const db = this.config.get('REDIS_DB', { infer: true });

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
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

  async exists(key: string): Promise<boolean> {
    return this.execute(async () => (await this.client.exists(key)) === 1);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.setex(key, ttlSeconds, serialized);
    } else {
      await this.set(key, serialized);
    }
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.connect();
    return this.circuitBreaker.execute(fn);
  }
}
