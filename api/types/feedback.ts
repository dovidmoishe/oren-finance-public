export const FEEDBACK_KINDS = ['feedback', 'bug', 'support'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = 'open' | 'resolved';

export interface FeedbackTicketInput {
  kind: FeedbackKind;
  subject: string;
  message: string;
  page?: string;
}

export interface FeedbackTicket {
  id: string;
  kind: FeedbackKind;
  subject: string;
  message: string;
  page?: string;
  status: FeedbackStatus;
  createdAt: string;
}
