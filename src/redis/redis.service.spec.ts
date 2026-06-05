import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
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

  beforeEach(async () => {
    jest.clearAllMocks();
    mockClient.status = 'wait';
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.exists.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string | number> = {
                REDIS_HOST: 'localhost',
                REDIS_PORT: 6379,
                REDIS_DB: 0,
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(RedisService);
    service.onModuleInit();
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
});
