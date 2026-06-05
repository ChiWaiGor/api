import {
  getArgon2OptionsFromEnv,
  hashPassword,
  verifyPassword,
} from './argon2.util';

describe('argon2.util', () => {
  const options = {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  };

  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('SecurePass1', options);
    expect(hash).not.toBe('SecurePass1');
    await expect(verifyPassword(hash, 'SecurePass1')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('returns false for invalid hash', async () => {
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('maps env to argon2 options', () => {
    expect(
      getArgon2OptionsFromEnv({
        ARGON2_MEMORY_KB: 65536,
        ARGON2_TIME_COST: 3,
        ARGON2_PARALLELISM: 4,
      }),
    ).toEqual(options);
  });
});
