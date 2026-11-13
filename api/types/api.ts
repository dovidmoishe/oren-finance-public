import type { ActivityFeed } from './activity';
import type {
  AgentChatRequest,
  AgentChatResponse,
  AgentThreadMessagesResponse,
} from './agent';
import type {
  TradingCalendarDayResponse,
  TradingCalendarQuery,
  TradingCalendarResponse,
} from './calendar';
import type { StockAnalysis, StockOpportunity } from './analysis';
import type { Equity, EquitySummary } from './equity';
import type {
  Basket,
  BasketCandidate,
  PreparedBasketPurchase,
  PreparedTransaction,
  QuoteRequest,
  TradeIntent,
} from './execution';
import type {
  ChartRange,
  ChartSeries,
  MarketMover,
  MarketsOverview,
} from './market';
import type { NewsFeed } from './news';
import type { Portfolio, PortfolioHistory } from './portfolio';
import type { Quote } from './quote';
import type { StockSignals } from './signals';
import type {
  CopyPortfolioPrepareRequest,
  CopyPortfolioProposal,
  LeaderboardResponse,
  SocialTimeframe,
  TraderDetailResponse,
  TraderVisibilityChallengeRequest,
  TraderVisibilityChallengeResponse,
  UpdateTraderVisibilityRequest,
  UpdateTraderVisibilityResponse,
} from './social';
import type {
  LockIntent,
  ConfirmLockRequest,
  ConfirmUnlockRequest,
  ConfirmVaultResponse,
  PreparedVaultTransaction,
  UnlockIntent,
  VaultSummary,
} from './vault';

/** GET /portfolio/:wallet */
export type GetPortfolioResponse = Portfolio;

/** GET /portfolio/:wallet/history */
export type GetPortfolioHistoryResponse = PortfolioHistory;

/** GET /portfolio/:wallet/activity */
export type GetPortfolioActivityResponse = ActivityFeed;

/** GET /portfolio/:wallet/calendar */
export type GetPortfolioCalendarQuery = TradingCalendarQuery;

export type GetPortfolioCalendarResponse = TradingCalendarResponse;

/** GET /portfolio/:wallet/calendar/:date */
export type GetPortfolioCalendarDayResponse = TradingCalendarDayResponse;

/** GET /stocks?page=&limit= */
export interface GetStocksQuery {
  page?: number;
  limit?: number;
}

export interface GetStocksResponse {
  items: EquitySummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/** GET /stocks/search?q= */
export interface SearchStocksQuery {
  q: string;
}

export type SearchStocksResponse = EquitySummary[];

/** GET /stocks/:assetId */
export type GetStockResponse = Equity;

/** GET /stocks/:assetId/chart?range= */
export interface GetStockChartQuery {
  range?: ChartRange;
}

export type GetStockChartResponse = ChartSeries;

/** GET /stocks/:assetId/news */
export type GetStockNewsResponse = NewsFeed;

/** GET /stocks/:assetId/analysis */
export type GetStockAnalysisResponse = StockAnalysis;

/** GET /markets/trending */
export type GetMarketTrendingResponse = MarketMover[];

/** GET /markets/opportunities */
export type GetMarketOpportunitiesResponse = StockOpportunity[];

/** Optional aggregate */
export type GetMarketsOverviewResponse = MarketsOverview;

/** GET /signals/:assetId (internal / agent) */
export type GetSignalsResponse = StockSignals;

/** POST /execution/quote */
export type PostExecutionQuoteRequest = TradeIntent | QuoteRequest;

export type PostExecutionQuoteResponse = Quote;

/** POST /execution/prepare */
export interface PostExecutionPrepareRequest {
  quoteId: string;
  wallet: string;
}

export type PostExecutionPrepareResponse = PreparedTransaction;

/** POST /execution/confirm */
export interface PostExecutionConfirmRequest {
  executionId?: string;
  quoteId: string;
  wallet: string;
  signature: string;
}

export interface PostExecutionConfirmResponse {
  executionId: string;
  quoteId: string;
  wallet: string;
  signature: string;
  status: 'submitted';
  trackingStatus: 'pending';
}

/** POST /execution/basket (P1) */
export interface PostBasketRequest {
  amountUsd: number;
  prompt: string;
  wallet?: string;
  candidates?: BasketCandidate[];
}

export type PostBasketResponse = Basket;

/** POST /execution/basket/prepare */
export interface PostBasketPrepareRequest {
  basketId: string;
  wallet: string;
}

export type PostBasketPrepareResponse = PreparedBasketPurchase;

/** POST /execution/limit-order */
export type PostLimitOrderRequest = import('./limit-order').LimitOrderIntent;
export type PostLimitOrderResponse = import('./limit-order').LimitOrderProposal;

/** POST /execution/limit-order/prepare */
export interface PostLimitOrderPrepareRequest {
  proposalId: string;
  wallet: string;
}
export type PostLimitOrderPrepareResponse =
  import('./limit-order').PreparedLimitOrder;

/** POST /execution/limit-order/confirm */
export interface PostLimitOrderConfirmRequest {
  proposalId: string;
  wallet: string;
  signature: string;
  orderKey?: string;
}

/** GET /execution/limit-orders/:wallet */
export type GetLimitOrdersResponse = import('./limit-order').LimitOrderRecord[];

/** GET /vaults/:wallet */
export type GetVaultsResponse = VaultSummary;

/** POST /vaults/prepare-lock */
export type PostPrepareLockRequest = LockIntent;

export type PostPrepareLockResponse = PreparedVaultTransaction;

/** POST /vaults/prepare-unlock */
export type PostPrepareUnlockRequest = UnlockIntent;

export type PostPrepareUnlockResponse = PreparedVaultTransaction;

/** POST /vaults/confirm-lock */
export type PostConfirmLockRequest = ConfirmLockRequest;

export type PostConfirmLockResponse = ConfirmVaultResponse;

/** POST /vaults/confirm-unlock */
export type PostConfirmUnlockRequest = ConfirmUnlockRequest;

export type PostConfirmUnlockResponse = ConfirmVaultResponse;

/** POST /agent/message */
export type PostAgentMessageRequest = AgentChatRequest;

export type PostAgentMessageResponse = AgentChatResponse;

/** GET /agent/threads/:threadId/messages?walletAddress= */
export type GetAgentThreadMessagesResponse = AgentThreadMessagesResponse;

/** GET /social/leaderboard */
export interface GetSocialLeaderboardQuery {
  timeframe?: SocialTimeframe;
  limit?: number;
}

export type GetSocialLeaderboardResponse = LeaderboardResponse;

/** GET /social/traders/:slug */
export type GetSocialTraderResponse = TraderDetailResponse;

/** POST /social/profiles/:wallet/visibility/challenge */
export type PostSocialProfileVisibilityChallengeRequest =
  TraderVisibilityChallengeRequest;

export type PostSocialProfileVisibilityChallengeResponse =
  TraderVisibilityChallengeResponse;

/** POST /social/profiles/:wallet/visibility */
export type PostSocialProfileVisibilityRequest =
  UpdateTraderVisibilityRequest;

export type PostSocialProfileVisibilityResponse =
  UpdateTraderVisibilityResponse;

/** POST /social/copy-portfolio/prepare */
export type PostSocialCopyPortfolioPrepareRequest =
  CopyPortfolioPrepareRequest;

export type PostSocialCopyPortfolioPrepareResponse = CopyPortfolioProposal;
