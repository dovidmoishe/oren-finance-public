import { Module } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { TokensModule } from '../tokens/tokens.module';
import { MarketService } from './market.service';
import { MarketsController } from './markets.controller';
import { StocksController } from './stocks.controller';

@Module({
  imports: [TokensModule, IntelligenceModule],
  controllers: [StocksController, MarketsController],
  providers: [MarketService],
  exports: [MarketService],
})
export class MarketModule {}
