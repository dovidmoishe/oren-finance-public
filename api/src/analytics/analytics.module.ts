import { Module } from '@nestjs/common';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { StockVolumeController, VolumeController } from './volume.controller';
import { VolumeRepository } from './volume.repository';
import { VolumeService } from './volume.service';
import { VolumeWorker } from './volume.worker';
import { DuneSyncService } from './dune-sync.service';

@Module({
  imports: [AlchemyModule, PortfolioModule],
  controllers: [VolumeController, StockVolumeController],
  providers: [VolumeRepository, VolumeService, VolumeWorker, DuneSyncService],
  exports: [VolumeService, VolumeRepository],
})
export class AnalyticsModule {}
