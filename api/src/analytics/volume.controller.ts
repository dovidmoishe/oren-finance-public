import { Controller, Get, Param, Query } from '@nestjs/common';
import type { VolumeInterval, VolumeRange } from '../../types/volume';
import { VolumeService } from './volume.service';

@Controller('analytics/volume')
export class VolumeController {
  constructor(private readonly volume: VolumeService) {}

  @Get()
  overview(@Query('range') range?: string, @Query('interval') interval?: string) {
    return this.volume.overview(parseRange(range), parseInterval(interval));
  }

  @Get('stocks')
  stocks(@Query('range') range?: string) {
    return this.volume.stocks(parseRange(range));
  }

  @Get('features')
  features(@Query('range') range?: string) {
    return this.volume.features(parseRange(range));
  }
}

@Controller('stocks')
export class StockVolumeController {
  constructor(private readonly volume: VolumeService) {}

  @Get(':assetId/volume')
  stock(@Param('assetId') assetId: string, @Query('range') range?: string) {
    return this.volume.stock(assetId, parseRange(range));
  }
}

function parseRange(value?: string): VolumeRange {
  return value === '24h' || value === '7d' || value === '30d' || value === 'all' ? value : '24h';
}

function parseInterval(value?: string): VolumeInterval {
  return value === 'day' ? 'day' : 'hour';
}
