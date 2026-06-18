import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthCryptoService } from './auth-crypto.service';

describe('AuthCryptoService', () => {
  let service: AuthCryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthCryptoService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, number> = {
                ARGON2_MEMORY_KB: 65536,
                ARGON2_TIME_COST: 3,
                ARGON2_PARALLELISM: 4,
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(AuthCryptoService);
  });

  it('hashes and verifies passwords', async () => {
    const hash = await service.hash('Admin123!@#');
    expect(hash).not.toBe('Admin123!@#');
    await expect(service.verify(hash, 'Admin123!@#')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });
});
