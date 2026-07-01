import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { API_V1_PREFIX, configureHttpApp } from '../app-config';
import { AppModule } from '../app.module';
import { toClientOpenApiSpec } from './client-spec.util';
import { createApiOpenApiDocument } from './create-openapi-document';

const DEFAULT_OUTPUT = 'openapi/client.json';

async function exportClientSpec(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bufferLogs: true,
  });
  configureHttpApp(app);
  await app.init();

  try {
    const document = createApiOpenApiDocument(app);
    const clientSpec = toClientOpenApiSpec(document, API_V1_PREFIX);

    const outputPath = resolve(
      process.cwd(),
      process.env.OPENAPI_CLIENT_OUTPUT ?? DEFAULT_OUTPUT,
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      `${JSON.stringify(clientSpec, null, 2)}\n`,
      'utf8',
    );

    console.log(`Wrote client OpenAPI spec to ${outputPath}`);
  } finally {
    await app.close();
  }
}

void exportClientSpec().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
