import { apiRequest } from "./api-client";
import type { FeedbackTicket, FeedbackTicketInput } from "@/types";

function options(walletAddress: string, token: string) {
  return {
    query: { walletAddress },
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store" as const,
  };
}

export function submitFeedback(
  input: FeedbackTicketInput,
  walletAddress: string,
  token: string,
): Promise<FeedbackTicket> {
  return apiRequest<FeedbackTicket>("/feedback", {
    ...options(walletAddress, token),
    method: "POST",
    body: input,
  });
}

export function listFeedback(
  walletAddress: string,
  token: string,
): Promise<FeedbackTicket[]> {
  return apiRequest<FeedbackTicket[]>("/feedback", options(walletAddress, token));
}
