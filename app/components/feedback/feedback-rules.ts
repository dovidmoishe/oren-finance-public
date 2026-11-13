export const FEEDBACK_SUBJECT_MAX = 120;
export const FEEDBACK_MESSAGE_MAX = 4000;

export const FEEDBACK_KIND_LABELS = {
  feedback: "Share feedback",
  bug: "Report a problem",
  support: "Get help",
} as const;

/** Mirrors the API's checks so people see a problem before sending. */
export function feedbackError(subject: string, message: string): string | undefined {
  const cleanSubject = subject.trim();
  const cleanMessage = message.trim();
  if (!cleanSubject) return "Add a short subject.";
  if (cleanSubject.length > FEEDBACK_SUBJECT_MAX) return `Keep the subject under ${FEEDBACK_SUBJECT_MAX} characters.`;
  if (!cleanMessage) return "Tell us a bit more in the message.";
  if (cleanMessage.length > FEEDBACK_MESSAGE_MAX) return `Keep the message under ${FEEDBACK_MESSAGE_MAX} characters.`;
  return undefined;
}

export function ticketReference(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
