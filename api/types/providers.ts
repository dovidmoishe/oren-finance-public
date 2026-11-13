import type { AlchemyProvider } from './providers/alchemy-provider';
import type { ExecutionProvider } from './providers/execution-provider';
import type { MarketDataProvider } from './providers/market-data-provider';
import type { TokensService } from './providers/tokens-provider';

export type { AlchemyProvider } from './providers/alchemy-provider';
export type {
  TokenAccount,
  TokenBalance,
  TransactionStatus,
  WalletTransaction,
  WalletTransfer,
} from './providers/alchemy-provider';
export type { ExecutionProvider } from './providers/execution-provider';
export type { MarketDataProvider } from './providers/market-data-provider';
export type { TokensService } from './providers/tokens-provider';

/** Primary external integrations for the MVP. */
export interface ProviderRegistry {
  tokens: TokensService;
  marketData: MarketDataProvider;
  alchemy: AlchemyProvider;
  execution: ExecutionProvider;
}
