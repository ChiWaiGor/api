import * as argon2 from 'argon2';

export type Argon2Options = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
};

export async function hashPassword(
  password: string,
  options: Argon2Options,
): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: options.memoryCost,
    timeCost: options.timeCost,
    parallelism: options.parallelism,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function getArgon2OptionsFromEnv(env: {
  ARGON2_MEMORY_KB: number;
  ARGON2_TIME_COST: number;
  ARGON2_PARALLELISM: number;
}): Argon2Options {
  return {
    memoryCost: env.ARGON2_MEMORY_KB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  };
}
