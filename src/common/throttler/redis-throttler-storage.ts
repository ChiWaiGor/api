import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisOptions } from 'ioredis';

/**
 * Redis-backed throttler storage so rate limits are enforced consistently
 * across multiple application instances (the default in-memory store counts
 * per-process, which lets clients bypass limits by hitting different pods).
 *
 * A Redis outage degrades to "allow" (fail-open): rate limiting is a
 * best-effort protection, so we prefer availability over returning errors for
 * every request when the store is unreachable. Auth, RBAC and the token
 * denylist guards still protect the application in that window.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly delegate: ThrottlerStorageRedisService;

  constructor(options: RedisOptions) {
    this.delegate = new ThrottlerStorageRedisService(options);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.delegate.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (error) {
      this.logger.error(
        `Redis throttler storage unavailable; failing open: ${
          (error as Error).message
        }`,
      );
      return {
        totalHits: 0,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  onModuleDestroy(): void {
    this.delegate.onModuleDestroy();
  }
}
