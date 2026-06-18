import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '../queue.constants';
import { MailQueueService } from './mail-queue.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Mail })],
  providers: [MailQueueService],
  exports: [MailQueueService],
})
export class MailQueueModule {}
