import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MailJobName, QueueName } from '../queue.constants';
import { MailQueueService } from './mail-queue.service';

describe('MailQueueService', () => {
  it('enqueues a mail job with configured retry settings', async () => {
    const mailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailQueueService,
        { provide: getQueueToken(QueueName.Mail), useValue: mailQueue },
        {
          provide: ConfigService,
          useValue: {
            get: () => 3,
          },
        },
      ],
    }).compile();

    const service = module.get(MailQueueService);
    await service.enqueueSend({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Body text',
    });

    expect(mailQueue.add).toHaveBeenCalledWith(
      MailJobName.Send,
      {
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body text',
      },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      }),
    );
  });

  it('uses MAIL_JOB_ATTEMPTS from config', async () => {
    const mailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailQueueService,
        { provide: getQueueToken(QueueName.Mail), useValue: mailQueue },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'MAIL_JOB_ATTEMPTS' ? 5 : undefined),
          },
        },
      ],
    }).compile();

    const service = module.get(MailQueueService);
    await service.enqueueSend({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Body text',
    });

    expect(mailQueue.add).toHaveBeenCalledWith(
      MailJobName.Send,
      expect.any(Object),
      expect.objectContaining({ attempts: 5 }),
    );
  });
});
