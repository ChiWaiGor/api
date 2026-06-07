import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { MailMessage } from './mail.types';

/**
 * Provider-agnostic mail sender. The transport is selected via `MAIL_TRANSPORT`.
 *
 * Only the `log` transport is implemented out of the box (dev/test friendly,
 * no external dependency). To add a real provider (SMTP/SES/Resend), implement
 * its delivery here behind a new `MAIL_TRANSPORT` value; callers depend only on
 * `send()` and never on the concrete provider.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  send(message: MailMessage): Promise<void> {
    const from = this.config.get('MAIL_FROM', { infer: true });
    const transport = this.config.get('MAIL_TRANSPORT', { infer: true });

    if (transport === 'smtp') {
      // No SMTP adapter is wired yet; log instead so auth flows keep working in
      // every environment until a provider is integrated.
      this.logger.warn(
        'MAIL_TRANSPORT=smtp has no adapter configured; logging message instead.',
      );
    }

    this.logger.log(
      `[mail] from=${from} to=${message.to} subject="${message.subject}"`,
    );
    this.logger.debug(message.text);
    return Promise.resolve();
  }
}
