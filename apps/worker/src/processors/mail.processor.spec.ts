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
});
