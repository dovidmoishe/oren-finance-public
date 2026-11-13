import { apiRequest } from "./api-client";

/** These routes require the Privy session of the wallet they act for. */
function authHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
import type {
  BasketIntent,
  BasketResponse,
  ConfirmExecutionRequest,
  PrepareExecutionRequest,
  ExecutionStatus,
  ExecutionPreparedTransaction,
  PreparedBasketPurchase,
  QuoteResponse,
  TradeIntent,
  LimitOrderCancelConfirmResponse,
  LimitOrderConfirmResponse,
  LimitOrderIntent,
  LimitOrderProposal,
  LimitOrderRecord,
  PreparedLimitCancel,
  PreparedLimitOrder,
} from "@/types";

export function getExecutionQuote(intent: TradeIntent) {
  return apiRequest<QuoteResponse>("/execution/quote", {
    method: "POST",
    body: intent,
  });
}

/** Silent re-quote of the same intent; the API serves it on its background lane. */
export function refreshExecutionQuote(intent: TradeIntent) {
  return getExecutionQuote({ ...intent, autoRefresh: true });
}

export function prepareExecution(request: PrepareExecutionRequest, token?: string | null) {
  return apiRequest<ExecutionPreparedTransaction>("/execution/prepare", {
    method: "POST",
    body: request,
    headers: authHeaders(token),
  });
}

export function confirmExecution(request: ConfirmExecutionRequest, token?: string | null) {
  return apiRequest<ExecutionStatus>("/execution/confirm", {
    method: "POST",
    body: request,
    headers: authHeaders(token),
  });
}

export function createBasket(intent: BasketIntent) {
  return apiRequest<BasketResponse>("/execution/basket", {
    method: "POST",
    body: intent,
  });
}

export function prepareBasket(intent: { basketId: string; wallet: string }) {
  return apiRequest<PreparedBasketPurchase>("/execution/basket/prepare", {
    method: "POST",
    body: intent,
  });
}

export function proposeLimitOrder(intent: LimitOrderIntent) {
  return apiRequest<LimitOrderProposal>("/execution/limit-order", {
    method: "POST",
    body: intent,
  });
}

export function prepareLimitOrder(
  request: {
    proposalId: string;
    wallet: string;
  },
  token?: string | null,
) {
  return apiRequest<PreparedLimitOrder>("/execution/limit-order/prepare", {
    method: "POST",
    body: request,
    headers: authHeaders(token),
  });
}

export function confirmLimitOrder(
  request: {
    proposalId: string;
    wallet: string;
    signature: string;
    orderKey?: string;
  },
  token?: string | null,
) {
  return apiRequest<LimitOrderConfirmResponse>("/execution/limit-order/confirm", {
    method: "POST",
    body: request,
    headers: authHeaders(token),
  });
}

export function listLimitOrders(
  wallet: string,
  options?: { includeHistory?: boolean },
) {
  const query = options?.includeHistory ? "?includeHistory=true" : "";
  return apiRequest<LimitOrderRecord[]>(
    `/execution/limit-orders/${encodeURIComponent(wallet)}${query}`,
  );
}

export function prepareCancelLimitOrder(
  request: {
    orderKey: string;
    wallet: string;
  },
  token?: string | null,
) {
  return apiRequest<PreparedLimitCancel>(
    "/execution/limit-order/prepare-cancel",
    {
      method: "POST",
      body: request,
      headers: authHeaders(token),
    },
  );
}

export function confirmCancelLimitOrder(
  request: {
    orderKey: string;
    wallet: string;
    signature: string;
  },
  token?: string | null,
) {
  return apiRequest<LimitOrderCancelConfirmResponse>(
    "/execution/limit-order/confirm-cancel",
    {
      method: "POST",
      body: request,
      headers: authHeaders(token),
    },
  );
}
