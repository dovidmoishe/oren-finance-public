import { Controller, Get, Param } from '@nestjs/common';
import type { GetSignalsResponse } from '../../types/api';
import { IntelligenceService } from './intelligence.service';

@Controller('signals')
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get(':assetId')
  getSignals(@Param('assetId') assetId: string): Promise<GetSignalsResponse> {
    return this.intelligence.getSignals(assetId);
  }
}
