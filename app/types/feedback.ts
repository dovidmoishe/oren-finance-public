export type FeedbackKind = "feedback" | "bug" | "support";
export type FeedbackStatus = "open" | "resolved";

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
