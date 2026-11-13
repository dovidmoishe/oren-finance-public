import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Senviok,
  type SenviokApiEndpointsEmailsSendEmailRequest,
  type SenviokApiEndpointsEmailsSendEmailResponse,
} from 'senviok';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';

export type SenviokEmailInput = Pick<
  SenviokApiEndpointsEmailsSendEmailRequest,
  'html' | 'templateData' | 'templateId' | 'text'
> & {
  to: string;
  subject: string;
} & ({ html: string } | { text: string } | { templateId: string });

@Injectable()
export class SenviokEmailService {
  private readonly client?: Senviok;
  private readonly from?: string;

  constructor(
    @Inject(APP_ENV)
    env: Pick<AppEnv, 'SENVIOK_API_KEY' | 'SENVIOK_FROM'>,
  ) {
    const apiKey = env.SENVIOK_API_KEY?.trim();
    this.from = env.SENVIOK_FROM?.trim();
    // A client without a sender can never send a valid application email.
    // Treat partial configuration as disabled and fail at send time.
    if (apiKey && this.from) {
      this.client = new Senviok(apiKey);
    }
  }

  async sendEmail(
    email: SenviokEmailInput,
  ): Promise<SenviokApiEndpointsEmailsSendEmailResponse> {
    if (!this.client || !this.from) {
      throw new ServiceUnavailableException('Senviok email is not configured');
    }

    const to = email.to.trim();
    const subject = email.subject.trim();
    if (!to || !subject) {
      throw new Error('Email recipient and subject are required');
    }

    const hasHtml =
      typeof email.html === 'string' && email.html.trim().length > 0;
    const hasText =
      typeof email.text === 'string' && email.text.trim().length > 0;
    const hasTemplate =
      typeof email.templateId === 'string' &&
      email.templateId.trim().length > 0;
    if (!hasHtml && !hasText && !hasTemplate) {
      throw new Error(
        'Email must include non-empty html, text, or templateId content',
      );
    }

    return this.client.emails.send({
      ...email,
      to,
      subject,
      from: this.from,
    });
  }
}
