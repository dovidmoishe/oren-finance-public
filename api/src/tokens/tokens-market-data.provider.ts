import { Injectable } from '@nestjs/common';
import type { Equity } from '../../types/equity';
import type { ChartRange, MarketCandle } from '../../types/market';
import type { MarketNewsItem } from '../../types/news';
import type { MarketDataProvider } from '../../types/providers/market-data-provider';
import { TokensService } from './tokens.service';

@Injectable()
export class TokensMarketDataProvider implements MarketDataProvider {
  constructor(private readonly tokens: TokensService) {}

  searchEquities(query: string): Promise<Equity[]> {
    return this.tokens.searchStocks(query);
  }

  getEquity(id: string): Promise<Equity> {
    return this.tokens.getStock(id);
  }

  async getPrice(id: string): Promise<number> {
    const equity = await this.tokens.getCurrentMarketData(id);
    if (equity.price === undefined) {
      throw new Error(`No price available for asset ${id}`);
    }
    return equity.price;
  }

  getChart(id: string, range: ChartRange): Promise<MarketCandle[]> {
    return this.tokens.getPriceChart(id, range);
  }

  getNews(id: string): Promise<MarketNewsItem[]> {
    return this.tokens.getNews(id);
  }
}
