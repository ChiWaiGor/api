import './instrument';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { Env } from '@app/shared';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  const trustProxy = config.get('TRUST_PROXY', { infer: true });

  // When behind a load balancer, trust X-Forwarded-* so req.ip and RBAC audit IPs
  // reflect the real client. Local dev defaults to false (direct connections).
  app.set('trust proxy', trustProxy);

  app.use(helmet());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Ensure Prisma/Redis disconnect and in-flight work drains on SIGTERM/SIGINT
  // (e.g. rolling deploys, container stop) instead of being killed abruptly.
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('API')
      .setDescription('NestJS auth and RBAC API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
