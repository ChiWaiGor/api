import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '@app/mail';
import { captureSentryException } from '@app/shared';
import { MailJobData, MailJobName, QueueName } from '@app/queue';

function mailWorkerConcurrency(): number {
  const value = process.env.MAIL_WORKER_CONCURRENCY;
  const parsed = value ? Number.parseInt(value, 10) : 5;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

@Processor(QueueName.Mail, {
  concurrency: mailWorkerConcurrency(),
})
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<MailJobData, void, MailJobName>): Promise<void> {
    if (job.name !== MailJobName.Send) {
      this.logger.warn(`Unknown mail job: ${String(job.name)}`);
      return;
    }

    try {
      await this.mailService.send(job.data);
    } catch (error) {
      captureSentryException(error, {
        queue: QueueName.Mail,
        jobName: job.name,
        jobId: job.id,
      });
      throw error;
    }
  }
}
