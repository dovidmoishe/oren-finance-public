import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type {
  GetStockAnalysisResponse,
  GetStockChartResponse,
  GetStockResponse,
  GetStocksResponse,
  SearchStocksResponse,
} from '../../types/api';
import type { ChartRange } from '../../types/market';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { MarketService } from './market.service';

class SearchStocksDto {
  @IsString()
  @MinLength(1)
  q!: string;
}

class ListStocksDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class ChartQueryDto {
  @IsOptional()
  @IsIn(['1D', '1W', '1M', '3M', '1Y', 'ALL'])
  range?: ChartRange;
}

@Controller('stocks')
export class StocksController {
  constructor(
    private readonly market: MarketService,
    private readonly intelligence: IntelligenceService,
  ) {}

  @Get()
  list(@Query() query: ListStocksDto): Promise<GetStocksResponse> {
    return this.market.listStocks(query.page ?? 1, query.limit ?? 20);
  }

  @Get('search')
  search(@Query() query: SearchStocksDto): Promise<SearchStocksResponse> {
    const q = query.q?.trim();
    if (!q) {
      throw new BadRequestException('Query parameter "q" is required');
    }
    return this.market.searchStocks(q);
  }

  @Get(':assetId/chart')
  chart(
    @Param('assetId') assetId: string,
    @Query() query: ChartQueryDto,
  ): Promise<GetStockChartResponse> {
    const range: ChartRange = query.range ?? '1M';
    return this.market.getChart(assetId, range);
  }

  @Get(':assetId/analysis')
  analysis(
    @Param('assetId') assetId: string,
  ): Promise<GetStockAnalysisResponse> {
    return this.intelligence.getAnalysis(assetId);
  }

  @Get(':assetId')
  detail(@Param('assetId') assetId: string): Promise<GetStockResponse> {
    return this.market.getStock(assetId);
  }
}
