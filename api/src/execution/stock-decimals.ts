import { Injectable, Logger, Optional } from '@nestjs/common';
import type { TokenizedEquity } from '../../types/equity';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { TokensBadRequestError } from '../common/errors/provider.errors';
import {
  effectiveMultiplier,
  parseScaledUiConfig,
  type ScaledUiConfig,
} from './scaled-amount';

interface ParsedMintInfo {
  value: {
    data?: {
      parsed?: {
        info?: {
          decimals?: unknown;
          extensions?: { extension?: unknown; state?: unknown }[];
        };
      };
    };
  } | null;
}

interface MintState {
  decimals: number;
  scaled?: ScaledUiConfig;
  readAt: number;
}

/** The scaled-UI multiplier can be updated by the issuer, so re-read it periodically. */
const SCALED_CONFIG_TTL_MS = 60_000;

/**
 * Stock token decimals and scaled-UI multiplier from the mint itself. The
 * catalog sometimes omits decimals, and guessing (the old USDC fallback of 6)
 * mis-sized 8-decimal xStock sells by 100x; ignoring the multiplier oversold
 * "sell all" orders. Decimals never change; the multiplier is refreshed.
 */
@Injectable()
export class StockDecimals {
  private readonly logger = new Logger(StockDecimals.name);
  private readonly cache = new Map<string, MintState>();

  constructor(@Optional() private readonly rpc?: AlchemyClient) {}

  async forVariant(variant: TokenizedEquity): Promise<TokenizedEquity> {
    const mint = await this.read(variant.mint);
    if (mint !== undefined) {
      if (variant.decimals !== undefined && variant.decimals !== mint.decimals)
        this.logger.warn(
          `Catalog decimals ${variant.decimals} differ from mint ${variant.mint} (${mint.decimals}); using the mint`,
        );
      return {
        ...variant,
        decimals: mint.decimals,
        uiMultiplier: effectiveMultiplier(mint.scaled),
      };
    }
    if (isDecimals(variant.decimals)) return variant;
    throw new TokensBadRequestError(
      `Token precision for ${variant.symbol || variant.mint} is unavailable. Try again shortly.`,
    );
  }

  private async read(mint: string): Promise<MintState | undefined> {
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.readAt < SCALED_CONFIG_TTL_MS)
      return cached;
    if (!this.rpc) return cached;
    try {
      const result = await this.rpc.call<ParsedMintInfo>('getAccountInfo', [
        mint,
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);
      const info = result.value?.data?.parsed?.info;
      const decimals = info?.decimals;
      if (!isDecimals(decimals)) return cached;
      const scaled = parseScaledUiConfig(
        info?.extensions?.find(
          (item) => item.extension === 'scaledUiAmountConfig',
        )?.state,
      );
      const state: MintState = { decimals, scaled, readAt: Date.now() };
      this.cache.set(mint, state);
      return state;
    } catch (error) {
      this.logger.warn(
        `Could not read mint ${mint}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // A stale multiplier is closer than assuming 1; decimals never change.
      return cached;
    }
  }
}

function isDecimals(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 18
  );
}
