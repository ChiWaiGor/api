import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { Env } from '@app/shared';
import { configureHttpApp } from './app-config';
import { AppModule } from './app.module';
import { createApiOpenApiDocument } from './openapi/create-openapi-document';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  configureHttpApp(app);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  // Ensure Prisma/Redis disconnect and in-flight work drains on SIGTERM/SIGINT
  // (e.g. rolling deploys, container stop) instead of being killed abruptly.
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = createApiOpenApiDocument(app);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
