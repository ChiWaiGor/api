import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createZodValidationPipe } from 'nestjs-zod';
import { LoggerModule } from 'nestjs-pino';
import { configuration } from './config/configuration';
import { Env } from './config/env.schema';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ZodValidationExceptionFilter } from './common/filters/zod-validation-exception.filter';
import { EmailVerifiedGuard } from './common/guards/email-verified.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler-storage';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

const ZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: false,
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [configuration],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        autoLogging: true,
        genReqId: (req) =>
          (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.refreshToken',
            'req.body.accessToken',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const password = config.get('REDIS_PASSWORD', { infer: true });
        return {
          throttlers: [
            {
              name: 'default',
              ttl: config.get('THROTTLE_TTL', { infer: true }),
              limit: config.get('THROTTLE_LIMIT', { infer: true }),
            },
            {
              name: 'auth',
              ttl: config.get('THROTTLE_AUTH_TTL', { infer: true }),
              limit: config.get('THROTTLE_AUTH_LIMIT', { infer: true }),
            },
            {
              name: 'auth-refresh',
              ttl: config.get('THROTTLE_AUTH_TTL', { infer: true }),
              limit: config.get('THROTTLE_AUTH_LIMIT', { infer: true }) * 2,
            },
          ],
          storage: new RedisThrottlerStorage({
            host: config.get('REDIS_HOST', { infer: true }),
            port: config.get('REDIS_PORT', { infer: true }),
            password: password || undefined,
            db: config.get('REDIS_DB', { infer: true }),
            maxRetriesPerRequest: 1,
            lazyConnect: true,
          }),
        };
      },
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RbacModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: ZodValidationExceptionFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
