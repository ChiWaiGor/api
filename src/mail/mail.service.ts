import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { Env } from '../config/env.schema';
import { MailMessage } from './mail.types';

/**
 * Provider-agnostic mail sender. The transport is selected via `MAIL_TRANSPORT`.
 *
 * - `log` — writes messages to the logger (default, dev/test friendly).
 * - `smtp` — sends via nodemailer; use Mailpit locally or any SMTP provider
 *   (SES, SendGrid, Postmark, etc.) in production.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const transport = this.config.get('MAIL_TRANSPORT', { infer: true });
    if (transport !== 'smtp') {
      return;
    }

    const host = this.config.get('SMTP_HOST', { infer: true });
    const port = this.config.get('SMTP_PORT', { infer: true });
    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASSWORD', { infer: true });
    const secure = this.config.get('SMTP_SECURE', { infer: true });

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user || pass ? { user: user ?? '', pass: pass ?? '' } : undefined,
    });

    this.logger.log(`SMTP transport configured (${host}:${port})`);
  }

  async send(message: MailMessage): Promise<void> {
    const from = this.config.get('MAIL_FROM', { infer: true });
    const transport = this.config.get('MAIL_TRANSPORT', { infer: true });

    if (transport === 'smtp') {
      await this.sendViaSmtp(from, message);
      return;
    }

    this.logMessage(from, message);
  }

  private async sendViaSmtp(from: string, message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.error('SMTP transport not initialized');
      return;
    }

    try {
      await this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      this.logMessage(from, message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to send mail to ${message.to}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private logMessage(from: string, message: MailMessage): void {
    this.logger.log(
      `[mail] from=${from} to=${message.to} subject="${message.subject}"`,
    );
    this.logger.debug(message.text);
  }
}
