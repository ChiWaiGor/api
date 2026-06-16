import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getArgon2OptionsFromEnv,
  hashPassword,
  verifyPassword,
} from '../common/crypto/argon2.util';
import { Env } from '@app/shared';

@Injectable()
export class AuthCryptoService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get options() {
    return getArgon2OptionsFromEnv({
      ARGON2_MEMORY_KB: this.config.get('ARGON2_MEMORY_KB', { infer: true }),
      ARGON2_TIME_COST: this.config.get('ARGON2_TIME_COST', { infer: true }),
      ARGON2_PARALLELISM: this.config.get('ARGON2_PARALLELISM', {
        infer: true,
      }),
    });
  }

  hash(password: string): Promise<string> {
    return hashPassword(password, this.options);
  }

  verify(hash: string, password: string): Promise<boolean> {
    return verifyPassword(hash, password);
  }
}
