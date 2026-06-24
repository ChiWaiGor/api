import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { RedisCircuitOpenError } from './redis-circuit-breaker';
import { RedisService } from './redis.service';

const mockClient = {
  status: 'wait',
  connect: jest.fn(),
  quit: jest.fn(),
  ping: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockClient);
});

describe('RedisService', () => {
  let service: RedisService;

  const createService = async (
    config: Record<string, string | number | boolean>,
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => config[key],
          },
        },
      ],
    }).compile();

    const svc = module.get(RedisService);
    svc.onModuleInit();
    return svc;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockClient.status = 'wait';
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.exists.mockResolvedValue(0);

    service = await createService({
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      REDIS_TLS: false,
    });
  });

  it('returns false when key does not exist', async () => {
    mockClient.exists.mockResolvedValue(0);
    await expect(service.exists('key')).resolves.toBe(false);
  });

  it('throws RedisCircuitOpenError when circuit is open', async () => {
    mockClient.exists.mockRejectedValue(new Error('connection refused'));

    for (let i = 0; i < 5; i += 1) {
      await expect(service.exists('key')).rejects.toThrow('connection refused');
    }

    await expect(service.exists('key')).rejects.toBeInstanceOf(
      RedisCircuitOpenError,
    );
    expect(mockClient.exists).toHaveBeenCalledTimes(5);
  });

  it('ping bypasses the circuit breaker', async () => {
    mockClient.status = 'ready';
    mockClient.ping.mockResolvedValue('PONG');

    await expect(service.ping()).resolves.toBe('PONG');
    expect(mockClient.ping).toHaveBeenCalled();
  });

  it('enables TLS when REDIS_TLS is true', async () => {
    await createService({
      REDIS_HOST: 'redis.example.com',
      REDIS_PORT: 6380,
      REDIS_DB: 0,
      REDIS_TLS: true,
    });

    expect(Redis).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: 'redis.example.com',
        port: 6380,
        tls: {},
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      }),
    );
  });

  it('get returns a stored value', async () => {
    mockClient.get.mockResolvedValue('value');
    await expect(service.get('key')).resolves.toBe('value');
  });

  it('set stores a value', async () => {
    await service.set('key', 'value');
    expect(mockClient.set).toHaveBeenCalledWith('key', 'value');
  });

  it('setex stores a value with TTL', async () => {
    await service.setex('key', 60, 'value');
    expect(mockClient.setex).toHaveBeenCalledWith('key', 60, 'value');
  });

  it('del skips redis when no keys are provided', async () => {
    await service.del();
    expect(mockClient.del).not.toHaveBeenCalled();
  });

  it('del removes keys', async () => {
    await service.del('a', 'b');
    expect(mockClient.del).toHaveBeenCalledWith('a', 'b');
  });

  it('incrWithTtl sets expiry on first increment', async () => {
    mockClient.incr.mockResolvedValue(1);
    mockClient.expire.mockResolvedValue(1);
    await expect(service.incrWithTtl('counter', 120)).resolves.toBe(1);
    expect(mockClient.expire).toHaveBeenCalledWith('counter', 120);
  });

  it('incrWithTtl skips expiry on subsequent increments', async () => {
    mockClient.incr.mockResolvedValue(2);
    await expect(service.incrWithTtl('counter', 120)).resolves.toBe(2);
    expect(mockClient.expire).not.toHaveBeenCalled();
  });

  it('getJson parses stored JSON', async () => {
    mockClient.get.mockResolvedValue(JSON.stringify({ ok: true }));
    await expect(service.getJson<{ ok: boolean }>('key')).resolves.toEqual({
      ok: true,
    });
  });

  it('getJson returns null for missing keys', async () => {
    mockClient.get.mockResolvedValue(null);
    await expect(service.getJson('key')).resolves.toBeNull();
  });

  it('setJson stores serialized values with TTL', async () => {
    await service.setJson('key', { ok: true }, 30);
    expect(mockClient.setex).toHaveBeenCalledWith(
      'key',
      30,
      JSON.stringify({ ok: true }),
    );
  });

  it('setJson stores serialized values without TTL', async () => {
    await service.setJson('key', { ok: true });
    expect(mockClient.set).toHaveBeenCalledWith(
      'key',
      JSON.stringify({ ok: true }),
    );
  });

  it('returns true when key exists', async () => {
    mockClient.exists.mockResolvedValue(1);
    await expect(service.exists('key')).resolves.toBe(true);
  });

  it('quits the client on module destroy when connected', async () => {
    mockClient.status = 'ready';
    await service.onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });

  it('quits the client on module destroy when connecting', async () => {
    mockClient.status = 'connect';
    await service.onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });

  it('does not quit the client when it is not connected', async () => {
    mockClient.status = 'wait';
    await service.onModuleDestroy();
    expect(mockClient.quit).not.toHaveBeenCalled();
  });

  it('exposes the underlying redis client', () => {
    expect(service.getClient()).toBe(mockClient);
  });

  it('connects when client is waiting', async () => {
    mockClient.status = 'wait';
    await service.connect();
    expect(mockClient.connect).toHaveBeenCalled();
  });

  it('logs redis client errors', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const errorHandler = mockClient.on.mock.calls.find(
      ([event]) => event === 'error',
    )?.[1] as ((err: Error) => void) | undefined;

    expect(errorHandler).toBeDefined();
    errorHandler!(new Error('connection lost'));

    expect(logSpy).toHaveBeenCalledWith('Redis error: connection lost');
    logSpy.mockRestore();
  });
});
