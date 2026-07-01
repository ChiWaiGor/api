import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ApiErrorDto } from '../common/filters/api-error.dto';

/** Builds the full internal OpenAPI document (same shape as `/docs` when enabled). */
export function createApiOpenApiDocument(app: INestApplication) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('API')
    .setDescription('NestJS auth and RBAC API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  return cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, swaggerConfig, {
      extraModels: [ApiErrorDto],
    }),
  );
}
