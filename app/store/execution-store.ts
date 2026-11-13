"use client";

import { create } from "zustand";
import { sessionSetter } from "@/services/wallet-session";
import { useWalletStore } from "./wallet-store";
import { confirmExecution, createBasket, getExecutionQuote, prepareBasket, prepareExecution, refreshExecutionQuote } from "@/services";
import type {
  BasketIntent,
  BasketResponse,
  ExecutionStatus,
  ExecutionPreparedTransaction,
  PreparedBasketPurchase,
  PrepareExecutionRequest,
  QuoteResponse,
  TradeIntent,
} from "@/types";

interface ExecutionState {
  quote?: QuoteResponse;
  /** Intent used to produce the current quote — enables silent refresh on expiry. */
  lastQuoteIntent?: TradeIntent;
  prepared?: ExecutionPreparedTransaction;
  preparedBasket?: PreparedBasketPurchase;
  basket?: BasketResponse;
  status?: ExecutionStatus;
  isLoading: boolean;
  isRefreshingQuote: boolean;
  error?: string;
  quoteTrade: (intent: TradeIntent) => Promise<QuoteResponse | undefined>;
  /** Re-quote the last intent. Automatic refreshes use the background lane. */
  refreshQuote: (options?: { manual?: boolean }) => Promise<QuoteResponse | undefined>;
  prepareTrade: (request: PrepareExecutionRequest, token?: string | null) => Promise<void>;
  confirmTrade: (wallet: string, executionId: string, quoteId: string, signature: string, token?: string | null) => Promise<void>;
  buildBasket: (intent: BasketIntent) => Promise<void>;
  prepareBasketTrades: (request: { basketId: string; wallet: string }) => Promise<void>;
  seedQuote: (quote: QuoteResponse, intent?: TradeIntent) => void;
  resetTrade: () => void;
  resetAll: () => void;
}

function intentFromQuote(quote: QuoteResponse): TradeIntent {
  return {
    assetId: quote.assetId,
    ticker: quote.ticker,
    side: quote.side,
    amountUsd: quote.side === "buy" ? quote.amountUsd : undefined,
    amount: quote.side === "sell" ? quote.inputAmount : undefined,
    preferredMint: quote.variant.mint,
    slippageBps: quote.slippageBps,
    wallet: useWalletStore.getState().address,
  };
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  isLoading: false,
  isRefreshingQuote: false,
  async quoteTrade(intent) {
    const update = sessionSetter(set);
    update({ isLoading: true, error: undefined, prepared: undefined, status: undefined });
    try {
      const quote = await getExecutionQuote(intent);
      update({
        quote,
        lastQuoteIntent: intent,
        isLoading: false,
        isRefreshingQuote: false,
      });
      return quote;
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to get quote",
        isLoading: false,
        isRefreshingQuote: false,
      });
      return undefined;
    }
  },
  async refreshQuote(options) {
    const update = sessionSetter(set);
    const previousIntent = get().lastQuoteIntent;
    if (!previousIntent) return undefined;
    // Agent artifacts contain public quote terms, not their server-side wallet
    // context. Use the active session wallet for both automatic and manual refresh.
    const intent = {
      ...previousIntent,
      wallet: useWalletStore.getState().address ?? previousIntent.wallet,
    };
    update({ isRefreshingQuote: true, error: undefined });
    try {
      // Automatic refreshes are flagged so they never take rate budget from
      // user swaps; a manual retry is a user waiting and stays on priority.
      const quote = options?.manual
        ? await getExecutionQuote(intent)
        : await refreshExecutionQuote(intent);
      update({
        quote,
        lastQuoteIntent: intent,
        prepared: undefined,
        status: undefined,
        isRefreshingQuote: false,
        isLoading: false,
      });
      return quote;
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to refresh quote",
        isRefreshingQuote: false,
      });
      return undefined;
    }
  },
  async prepareTrade(request, token) {
    const update = sessionSetter(set);
    update({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareExecution(request, token);
      update({ prepared, isLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to prepare trade", isLoading: false });
    }
  },
  async confirmTrade(wallet, executionId, quoteId, signature, token) {
    const update = sessionSetter(set);
    update({ isLoading: true, error: undefined });
    try {
      const status = await confirmExecution({ wallet, executionId, quoteId, signature }, token);
      update({ status, isLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to confirm trade", isLoading: false });
    }
  },
  async buildBasket(intent) {
    const update = sessionSetter(set);
    update({ isLoading: true, error: undefined, preparedBasket: undefined });
    try {
      const basket = await createBasket(intent);
      update({ basket, isLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to create basket", isLoading: false });
    }
  },
  async prepareBasketTrades(intent) {
    const update = sessionSetter(set);
    update({ isLoading: true, error: undefined });
    try {
      const preparedBasket = await prepareBasket(intent);
      update({ preparedBasket, isLoading: false });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Unable to prepare basket", isLoading: false });
    }
  },
  seedQuote(quote, intent) {
    set({
      quote,
      lastQuoteIntent: intent ?? intentFromQuote(quote),
      prepared: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
      isRefreshingQuote: false,
    });
  },
  resetTrade() {
    set({
      quote: undefined,
      lastQuoteIntent: undefined,
      prepared: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
      isRefreshingQuote: false,
    });
  },
  resetAll() {
    set({
      quote: undefined,
      lastQuoteIntent: undefined,
      prepared: undefined,
      preparedBasket: undefined,
      basket: undefined,
      status: undefined,
      error: undefined,
      isLoading: false,
      isRefreshingQuote: false,
    });
  },
}));
