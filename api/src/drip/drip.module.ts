import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { DripService } from './drip.service';
import { DripQuotaService } from './drip-quota.service';

@Module({
  imports: [MarketModule],
  providers: [DripService, DripQuotaService],
  exports: [DripService],
})
export class DripModule {}
