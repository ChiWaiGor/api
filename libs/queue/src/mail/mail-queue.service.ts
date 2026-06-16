import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { MailMessage } from '@app/mail';
import { Env } from '@app/shared';
import { MailJobName, QueueName } from '../queue.constants';

@Injectable()
export class MailQueueService {
  constructor(
    @InjectQueue(QueueName.Mail) private readonly mailQueue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async enqueueSend(message: MailMessage): Promise<void> {
    const attempts = this.config.get('MAIL_JOB_ATTEMPTS', { infer: true });

    await this.mailQueue.add(MailJobName.Send, message, {
      attempts,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    });
  }
}
