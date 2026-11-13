import { Module } from '@nestjs/common';
import { StockCatalogRepository } from './stock-catalog.repository';
import { TokensClient } from './tokens.client';
import { TokensMarketDataProvider } from './tokens-market-data.provider';
import { TokensService } from './tokens.service';

@Module({
  providers: [
    TokensClient,
    TokensService,
    TokensMarketDataProvider,
    StockCatalogRepository,
  ],
  exports: [
    TokensService,
    TokensMarketDataProvider,
    TokensClient,
    StockCatalogRepository,
  ],
})
export class TokensModule {}
