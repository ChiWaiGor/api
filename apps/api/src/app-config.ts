import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Env } from '@app/shared';

/** Versioned REST API base path (e.g. `/api/v1/auth/login`). */
export const API_V1_PREFIX = '/api/v1';

/** Shared HTTP middleware used by main.ts and e2e test bootstrap. */
export function configureHttpApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/ready'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: ['X-CSRF-Token'],
  });
}
