import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { buildRedisOptions, Env } from '@app/shared';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const prefix = config.get('QUEUE_PREFIX', { infer: true });

        return {
          ...(prefix ? { prefix } : {}),
          connection: buildRedisOptions(config, {
            maxRetriesPerRequest: null,
          }),
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
