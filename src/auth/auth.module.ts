import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Env } from '../config/env.schema';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './auth.controller';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }),
        },
      }),
    }),
    RbacModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthCryptoService, JwtStrategy],
  exports: [AuthService, AuthCryptoService],
})
export class AuthModule {}
