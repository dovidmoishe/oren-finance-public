import { Controller, Get, Param, Query } from '@nestjs/common';
import type { GetStockNewsResponse } from '../../types/api';
import { clampLimit, NewsService } from './news.service';

interface NewsQuery {
  limit?: string;
}

@Controller('stocks')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get(':assetId/news')
  getStockNews(
    @Param('assetId') assetId: string,
    @Query() query: NewsQuery,
  ): Promise<GetStockNewsResponse> {
    return this.news.getEquityNews(assetId, {
      limit: clampLimit(query.limit),
    });
  }
}
