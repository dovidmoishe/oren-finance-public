import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  FEEDBACK_KINDS,
  type FeedbackKind,
  type FeedbackTicket,
  type FeedbackTicketInput,
} from '../../types/feedback';
import { FeedbackRepository } from './feedback.repository';

export const FEEDBACK_HOURLY_LIMIT = 5;
const SUBJECT_MAX = 120;
const MESSAGE_MAX = 4000;
const PAGE_MAX = 300;

@Injectable()
export class FeedbackService {
  constructor(private readonly repository: FeedbackRepository) {}

  async submit(
    owner: { userId: string; walletAddress: string; email?: string },
    body: unknown,
  ): Promise<FeedbackTicket> {
    const input = parseFeedback(body);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    if (
      (await this.repository.countSince(owner.userId, since)) >=
      FEEDBACK_HOURLY_LIMIT
    ) {
      throw new HttpException(
        'You have sent several requests in the last hour. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.repository.create(owner, input);
  }

  list(userId: string): Promise<FeedbackTicket[]> {
    return this.repository.list(userId);
  }
}

export function parseFeedback(body: unknown): FeedbackTicketInput {
  const value =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (!FEEDBACK_KINDS.includes(value.kind as FeedbackKind))
    throw new BadRequestException('Choose feedback, a bug, or support');
  const subject = text(value.subject);
  if (!subject || subject.length > SUBJECT_MAX)
    throw new BadRequestException(
      `Subject must be 1–${SUBJECT_MAX} characters`,
    );
  const message = text(value.message);
  if (!message || message.length > MESSAGE_MAX)
    throw new BadRequestException(
      `Message must be 1–${MESSAGE_MAX} characters`,
    );
  const page = text(value.page)?.slice(0, PAGE_MAX);
  return {
    kind: value.kind as FeedbackKind,
    subject,
    message,
    ...(page && page.startsWith('/') ? { page } : {}),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}
