import './instrument'; // OTel + Sentry bootstrap before Nest

import { createServer } from 'http';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { Env } from '@app/shared';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const logger = app.get(Logger);

  // Minimal liveness endpoint so container orchestrators can health-check the
  // worker (it has no HTTP API of its own).
  const config = app.get(ConfigService<Env, true>);
  const healthPort = config.get('WORKER_HEALTH_PORT', { infer: true });
  const healthServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  healthServer.listen(healthPort, '0.0.0.0');

  const shutdown = () => healthServer.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  logger.log(`Worker application started (health on :${healthPort}/health)`);
}

void bootstrap();
