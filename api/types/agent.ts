import type { ActivityFeed } from './activity';
import type {
  TradingCalendarDayResponse,
  TradingCalendarResponse,
} from './calendar';
import type { StockAnalysis, StockOpportunity } from './analysis';
import type { Equity, EquitySummary } from './equity';
import type {
  Basket,
  PreparedBasketPurchase,
  PreparedTransaction,
} from './execution';
import type { ChartSeries } from './market';
import type { MarketNewsItem } from './news';
import type { Portfolio } from './portfolio';
import type { Quote } from './quote';
import type { StockSignals } from './signals';
import type { BitgetMarketContext } from './bitget';
import type {
  CopyPortfolioProposal,
  LeaderboardResponse,
  TraderDetailResponse,
} from './social';
import type { PreparedVaultTransaction, VaultSummary } from './vault';

export type AgentMessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface AgentThread {
  id: string;
  walletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentMessage {
  id: string;
  threadId: string;
  role: AgentMessageRole;
  content: string;
  toolName?: string;
  toolPayload?: unknown;
  createdAt: Date;
}

export interface AgentChatRequest {
  walletAddress: string;
  threadId?: string;
  message: string;
  context?: AgentPageContext;
}

export interface AgentChatResponse {
  threadId: string;
  message: AgentDisplayMessage;
  artifacts?: AgentArtifact[];
  events?: AgentStreamEvent[];
}

export type AgentPage =
  | 'dashboard'
  | 'calendar'
  | 'leaderboard'
  | 'markets'
  | 'stock'
  | 'vault'
  | 'activity';

export interface AgentPortfolioPositionContext {
  assetId: string;
  ticker: string;
  name: string;
  quantity: number;
  valueUsd: number;
  allocationPct: number;
  change24hPct?: number;
}

/** Compact portfolio snapshot injected into agent instructions. */
export interface AgentPortfolioContext {
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  cashValueUsd?: number;
  changeUsd?: number;
  changePct?: number;
  positions: AgentPortfolioPositionContext[];
  updatedAt?: string;
}

export interface AgentPageContext {
  page: AgentPage;
  assetId?: string;
}

export type AgentArtifact =
  | { type: 'research'; data: import('./research').StockResearch }
  | { type: 'portfolio'; data: Portfolio }
  | { type: 'stock'; data: Equity }
  | { type: 'bitget_market'; data: BitgetMarketContext }
  | { type: 'basket'; data: Basket }
  | { type: 'quote'; data: Quote }
  | { type: 'limit_order'; data: import('./limit-order').LimitOrderProposal }
  | { type: 'limit_orders'; data: import('./limit-order').LimitOrderRecord[] }
  | { type: 'analysis'; data: StockAnalysis }
  | { type: 'prepared_swap'; data: PreparedTransaction }
  | { type: 'prepared_basket'; data: PreparedBasketPurchase }
  | { type: 'prepared_lock'; data: PreparedVaultTransaction }
  | { type: 'prepared_unlock'; data: PreparedVaultTransaction }
  | { type: 'copy_portfolio_proposal'; data: CopyPortfolioProposal }
  | { type: 'trading_calendar'; data: TradingCalendarResponse }
  | { type: 'trading_calendar_day'; data: TradingCalendarDayResponse }
  | { type: 'opportunities'; data: StockOpportunity[] }
  | { type: 'vaults'; data: VaultSummary };

export type AgentToolStatus = 'running' | 'completed' | 'failed';

export interface AgentToolActivity {
  callId: string;
  toolName: string;
  status: AgentToolStatus;
  error?: string;
}

export interface AgentDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  activities?: AgentToolActivity[];
  artifacts?: AgentArtifact[];
  interrupted?: boolean;
}

export interface AgentThreadMessagesResponse {
  thread: AgentThread;
  messages: AgentDisplayMessage[];
}

interface AgentStreamEventBase {
  turnId: string;
  sequence: number;
  timestamp: Date;
}

export type AgentStreamEvent =
  | (AgentStreamEventBase & {
      type: 'turn_started';
      threadId: string;
      message: AgentDisplayMessage;
    })
  | (AgentStreamEventBase & {
      type: 'assistant_delta';
      delta: string;
    })
  | (AgentStreamEventBase & {
      type: 'assistant_reset';
    })
  | (AgentStreamEventBase & {
      type: 'tool_started';
      callId: string;
      toolName: string;
    })
  | (AgentStreamEventBase & {
      type: 'tool_completed';
      callId: string;
      toolName: string;
      artifact?: AgentArtifact;
    })
  | (AgentStreamEventBase & {
      type: 'tool_failed';
      callId: string;
      toolName: string;
      error: string;
    })
  | (AgentStreamEventBase & {
      type: 'turn_completed';
      threadId: string;
      message: AgentDisplayMessage;
      artifacts?: AgentArtifact[];
    })
  | (AgentStreamEventBase & {
      type: 'turn_failed';
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    });

/** @deprecated Use AgentStreamEvent. */
export type AgentEvent = AgentStreamEvent;

/** @deprecated Stream event names are represented by AgentStreamEvent.type. */
export type AgentEventType = AgentStreamEvent['type'];

export interface LegacyAgentEvent {
  type: AgentEventType;
  timestamp: Date;
  toolName?: string;
  messageId?: string;
  error?: string;
}

/**
 * Agent tool contracts — results must be grounded in Oren services.
 */
export interface AgentTools {
  getPortfolio(wallet: string): Promise<Portfolio>;

  getPortfolioActivity(wallet: string): Promise<ActivityFeed>;

  getTradingCalendar(input: {
    wallet: string;
    month?: string;
    start?: string;
    end?: string;
    timeZone?: string;
  }): Promise<TradingCalendarResponse>;

  getTradingCalendarDay(input: {
    wallet: string;
    date: string;
    timeZone?: string;
  }): Promise<TradingCalendarDayResponse>;

  getStock(assetIdOrTicker: string): Promise<Equity>;

  getBitgetMarketContext(
    assetIdOrTicker: string,
    range?: string,
  ): Promise<BitgetMarketContext>;

  getStockChart(assetIdOrTicker: string, range?: string): Promise<ChartSeries>;

  getStockNews(assetIdOrTicker: string): Promise<MarketNewsItem[]>;

  analyzeStock(assetIdOrTicker: string): Promise<StockAnalysis>;

  searchStocks(query: string): Promise<EquitySummary[]>;

  findOpportunities(input?: {
    category?: string;
    sector?: string;
    minScore?: number;
    limit?: number;
  }): Promise<StockOpportunity[]>;

  createBasket(input: {
    amountUsd: number;
    prompt: string;
    wallet?: string;
  }): Promise<Basket>;

  getSwapQuote(input: {
    side: 'buy' | 'sell';
    ticker: string;
    amountUsd?: number;
    amount?: number;
  }): Promise<Quote>;

  prepareSwap(quoteId: string, wallet: string): Promise<PreparedTransaction>;

  prepareBasketPurchase(
    basketId: string,
    wallet: string,
  ): Promise<PreparedBasketPurchase>;

  getVaults(wallet: string): Promise<VaultSummary>;

  prepareLock(input: {
    wallet: string;
    asset: string;
    amount: number;
    unlockAt: Date;
  }): Promise<PreparedVaultTransaction>;

  prepareUnlock(input: {
    wallet: string;
    lockAddress: string;
  }): Promise<PreparedVaultTransaction>;

  getSignals(assetIdOrTicker: string): Promise<StockSignals>;

  getLeaderboard(input?: {
    timeframe?: string;
    limit?: number;
  }): Promise<LeaderboardResponse>;

  getTraderProfile(
    slug: string,
    timeframe?: string,
  ): Promise<TraderDetailResponse>;

  prepareCopyPortfolio(input: {
    sourceSlug: string;
    wallet: string;
    amountUsd: number;
  }): Promise<CopyPortfolioProposal>;
}
