import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { MailMessage, MailService } from '@app/mail';
import { MailJobName } from '@app/queue';
import { MailProcessor } from './mail.processor';

describe('MailProcessor', () => {
  let processor: MailProcessor;
  const mailService = { send: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailProcessor,
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    processor = module.get(MailProcessor);
    jest.clearAllMocks();
  });

  it('sends mail for send jobs', async () => {
    const job = {
      name: MailJobName.Send,
      data: {
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body',
      },
    } as Job<MailMessage, void, MailJobName>;

    await processor.process(job);

    expect(mailService.send).toHaveBeenCalledWith(job.data);
  });

  it('ignores unknown job names', async () => {
    const job = {
      name: 'unknown',
      data: {
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body',
      },
    } as unknown as Job<MailMessage, void, MailJobName>;

    await processor.process(job);

    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('reports send failures to Sentry and rethrows', async () => {
    const captureMock = jest.spyOn(
      await import('@app/shared'),
      'captureSentryException',
    );
    const error = new Error('SMTP unavailable');
    mailService.send.mockRejectedValueOnce(error);

    const job = {
      id: 'job-1',
      name: MailJobName.Send,
      data: {
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body',
      },
    } as Job<MailMessage, void, MailJobName>;

    await expect(processor.process(job)).rejects.toThrow('SMTP unavailable');
    expect(captureMock).toHaveBeenCalledWith(error, {
      queue: 'mail',
      jobName: MailJobName.Send,
      jobId: 'job-1',
    });

    captureMock.mockRestore();
  });
});
