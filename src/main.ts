import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { Env } from './config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });

  app.use(helmet());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

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

  await app.listen(port);
}

void bootstrap();
