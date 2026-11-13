import { apiRequest } from "./api-client";
import { SESSION_PROVIDER_WAIT_MS, sessionAuthorization } from "./session-token";
import { routeVenueLabel } from "./route-label";
import type {
  PortfolioActivityItem,
  PortfolioRange,
  PortfolioSnapshot,
  PortfolioSummary,
  TradingCalendarDayResponse,
  TradingCalendarResponse,
} from "@/types";

interface ApiPortfolioPosition {
  assetId: string;
  ticker: string;
  name: string;
  logo?: string;
  quantity: number;
  availableAmount: number;
  lockedAmount: number;
  currentPrice: number;
  valueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  allocationPercent: number;
  priceChange24h?: number;
}

interface ApiPortfolioSummary {
  walletAddress: string;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  cashValueUsd?: number;
  absoluteChangeUsd: number;
  percentChange: number;
  positions: ApiPortfolioPosition[];
  updatedAt: string;
}

interface ApiPortfolioHistory {
  walletAddress: string;
  points: PortfolioSnapshot[];
}

type ApiActivityItem =
  | {
      source: "oren";
      id: string;
      type:
        | "stock_purchase"
        | "stock_sale"
        | "basket_purchase"
        | "lock"
        | "unlock"
        | "limit_buy"
        | "limit_sell"
        | "limit_cancel";
      ticker?: string;
      assetId?: string;
      amount?: number;
      amountUsd?: number;
      provider?: string | null;
      transactionSignature?: string;
      status: string;
      createdAt: string;
    }
  | {
      source: "wallet";
      signature: string;
      blockTime?: string;
      status: string;
    };

interface ApiActivityFeed {
  walletAddress: string;
  items: ApiActivityItem[];
}

type ApiExecutionActivityType = Extract<ApiActivityItem, { source: "oren" }>["type"];

export function getPortfolio(wallet: string) {
  return apiRequest<ApiPortfolioSummary>(`/portfolio/${wallet}`).then(mapPortfolio);
}

/** History, activity and calendar hold Oren-only data and need the owner's session. */
export async function getPortfolioHistory(wallet: string, range?: PortfolioRange) {
  const history = await apiRequest<ApiPortfolioHistory>(`/portfolio/${wallet}/history`, {
    query: { range },
    headers: await sessionAuthorization(SESSION_PROVIDER_WAIT_MS),
  });
  return history.points;
}

export async function getPortfolioActivity(wallet: string) {
  const feed = await apiRequest<ApiActivityFeed>(`/portfolio/${wallet}/activity`, {
    headers: await sessionAuthorization(SESSION_PROVIDER_WAIT_MS),
  });
  return feed.items.map(mapActivityItem);
}

export async function getTradingCalendar(
  wallet: string,
  input: { month?: string; start?: string; end?: string; timeZone?: string },
) {
  return apiRequest<TradingCalendarResponse>(`/portfolio/${wallet}/calendar`, {
    query: input,
    headers: await sessionAuthorization(SESSION_PROVIDER_WAIT_MS),
  });
}

export async function getTradingCalendarDay(
  wallet: string,
  date: string,
  input: { timeZone?: string },
) {
  return apiRequest<TradingCalendarDayResponse>(`/portfolio/${wallet}/calendar/${date}`, {
    query: input,
    headers: await sessionAuthorization(SESSION_PROVIDER_WAIT_MS),
  });
}

export function mapPortfolio(portfolio: ApiPortfolioSummary): PortfolioSummary {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];

  return {
    wallet: portfolio.walletAddress,
    totalValueUsd: portfolio.totalValueUsd,
    availableValueUsd: portfolio.availableValueUsd,
    lockedValueUsd: portfolio.lockedValueUsd,
    cashValueUsd: portfolio.cashValueUsd ?? 0,
    changeUsd: portfolio.absoluteChangeUsd,
    changePct: portfolio.percentChange,
    updatedAt: portfolio.updatedAt,
    positions: positions.map((position) => ({
      assetId: position.assetId,
      ticker: position.ticker,
      name: position.name,
      logoUrl: position.logo,
      quantity: position.quantity,
      availableQuantity: position.availableAmount,
      lockedQuantity: position.lockedAmount,
      priceUsd: position.currentPrice,
      valueUsd: position.valueUsd,
      availableValueUsd: position.availableValueUsd,
      lockedValueUsd: position.lockedValueUsd,
      allocationPct: position.allocationPercent,
      change24hPct: position.priceChange24h,
    })),
  };
}

export function mapActivityItem(item: ApiActivityItem): PortfolioActivityItem {
  if (item.source === "oren") {
    return {
      id: item.id,
      type: mapExecutionType(item.type),
      ticker: item.ticker,
      assetId: item.assetId,
      quantity: item.amount,
      valueUsd: item.amountUsd,
      status: item.status,
      signature: item.transactionSignature,
      route: routeVenueLabel(item.provider),
      occurredAt: item.createdAt,
    };
  }

  return {
    id: item.signature,
    type: "transfer",
    status: item.status,
    signature: item.signature,
    occurredAt: item.blockTime ?? new Date().toISOString(),
  };
}

function mapExecutionType(type: ApiExecutionActivityType): PortfolioActivityItem["type"] {
  switch (type) {
    case "stock_purchase":
    case "stock_sale":
    case "limit_buy":
    case "limit_sell":
      return "trade";
    case "basket_purchase":
      return "basket";
    case "lock":
    case "unlock":
      return type;
    default:
      return "unknown";
  }
}
