import type { TradeSide } from '../../../types/quote';
import { USDC_DECIMALS } from '../../config/constants';
import { stockSharesToRaw } from '../scaled-amount';

/** Jupiter Trigger V1 minimum making notional (~$5). */
export const LIMIT_ORDER_MIN_USD = 5;

export interface LimitRateInput {
  side: TradeSide;
  /** Buy: USD notional. Sell: stock quantity. */
  amount: number;
  limitPriceUsd: number;
  stockDecimals: number;
  /** Scaled-UI multiplier (xStocks); share amounts are divided by it for raw units. */
  stockMultiplier?: number;
  marketPriceUsd?: number;
}

export interface LimitRateResult {
  makingAmount: number;
  takingAmount: number;
  makingAmountRaw: string;
  takingAmountRaw: string;
  amountUsd: number;
  wouldFillImmediately: boolean;
}

/**
 * Convert a USD limit price into Jupiter Trigger V1 making/taking amounts.
 *
 * Buy $N at $P: pay N USDC, receive N/P shares.
 * Sell Q shares at $P: pay Q shares, receive Q*P USDC.
 */
export function computeLimitOrderAmounts(
  input: LimitRateInput,
): LimitRateResult {
  const { side, amount, limitPriceUsd, stockDecimals, marketPriceUsd } = input;
  const stockRaw = (shares: number) =>
    String(stockSharesToRaw(shares, stockDecimals, input.stockMultiplier ?? 1));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be > 0');
  }
  if (!Number.isFinite(limitPriceUsd) || limitPriceUsd <= 0) {
    throw new Error('limitPriceUsd must be > 0');
  }

  if (side === 'buy') {
    const makingAmount = amount;
    const takingAmount = amount / limitPriceUsd;
    const amountUsd = makingAmount;
    if (amountUsd < LIMIT_ORDER_MIN_USD) {
      throw new Error(
        `Limit order making amount must be at least $${LIMIT_ORDER_MIN_USD}`,
      );
    }
    const wouldFillImmediately =
      marketPriceUsd !== undefined &&
      Number.isFinite(marketPriceUsd) &&
      limitPriceUsd >= marketPriceUsd;

    return {
      makingAmount,
      takingAmount,
      makingAmountRaw: toRawAmount(makingAmount, USDC_DECIMALS),
      takingAmountRaw: stockRaw(takingAmount),
      amountUsd,
      wouldFillImmediately,
    };
  }

  const makingAmount = amount;
  const takingAmount = amount * limitPriceUsd;
  const amountUsd = takingAmount;
  if (amountUsd < LIMIT_ORDER_MIN_USD) {
    throw new Error(
      `Limit order making amount must be at least $${LIMIT_ORDER_MIN_USD}`,
    );
  }
  const wouldFillImmediately =
    marketPriceUsd !== undefined &&
    Number.isFinite(marketPriceUsd) &&
    limitPriceUsd <= marketPriceUsd;

  return {
    makingAmount,
    takingAmount,
    makingAmountRaw: stockRaw(makingAmount),
    takingAmountRaw: toRawAmount(takingAmount, USDC_DECIMALS),
    amountUsd,
    wouldFillImmediately,
  };
}

export function toRawAmount(uiAmount: number, decimals: number): string {
  const factor = 10 ** decimals;
  const raw = Math.round(uiAmount * factor);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error('Computed raw amount is invalid');
  }
  return String(raw);
}

/** Default limit order expiry: 30 days from now (unix seconds). */
export function defaultLimitExpiredAt(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + 30 * 24 * 60 * 60;
}
