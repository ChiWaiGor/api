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
});
