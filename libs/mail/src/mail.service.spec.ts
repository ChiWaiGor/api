import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import nodemailer from 'nodemailer';
import { MailService } from './mail.service';

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

describe('MailService', () => {
  const buildModule = async (config: Record<string, unknown>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => config[key],
          },
        },
      ],
    }).compile();

    return module.get(MailService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('log transport', () => {
    it('logs the message without calling nodemailer', async () => {
      const service = await buildModule({
        MAIL_TRANSPORT: 'log',
        MAIL_FROM: 'no-reply@example.com',
      });

      service.onModuleInit();
      await service.send({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Body text',
      });

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        '[mail] from=no-reply@example.com to=user@example.com subject="Hello"',
      );
      expect(Logger.prototype.debug).toHaveBeenCalledWith('Body text');
    });
  });

  describe('smtp transport', () => {
    it('creates a transporter on init and sends mail', async () => {
      const service = await buildModule({
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'no-reply@example.com',
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        SMTP_SECURE: false,
      });

      service.onModuleInit();
      await service.send({
        to: 'user@example.com',
        subject: 'Reset your password',
        text: 'Click here',
        html: '<p>Click here</p>',
      });

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'localhost',
        port: 1025,
        secure: false,
        auth: undefined,
      });
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'no-reply@example.com',
        to: 'user@example.com',
        subject: 'Reset your password',
        text: 'Click here',
        html: '<p>Click here</p>',
      });
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        '[mail] from=no-reply@example.com to=user@example.com subject="Reset your password"',
      );
    });

    it('passes auth when SMTP credentials are set', async () => {
      const service = await buildModule({
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'no-reply@example.com',
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_PORT: 587,
        SMTP_USER: 'apikey',
        SMTP_PASSWORD: 'secret',
        SMTP_SECURE: false,
      });

      service.onModuleInit();

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        auth: { user: 'apikey', pass: 'secret' },
      });
    });

    it('logs and rethrows when SMTP send fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('connection refused'));
      const service = await buildModule({
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'no-reply@example.com',
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        SMTP_SECURE: false,
      });

      service.onModuleInit();
      await expect(
        service.send({
          to: 'user@example.com',
          subject: 'Hello',
          text: 'Body',
        }),
      ).rejects.toThrow('connection refused');

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to send mail to user@example.com: connection refused',
        expect.any(String),
      );
    });
  });
});
