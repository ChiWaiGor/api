import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { MailModule } from '@app/mail';
import { MailQueueModule, QueueModule } from '@app/queue';
import { configuration } from '@app/shared';
import { MailProcessor } from './processors/mail.processor';

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
      },
    }),
    QueueModule,
    MailQueueModule,
    MailModule,
  ],
  providers: [MailProcessor],
})
export class WorkerModule {}
