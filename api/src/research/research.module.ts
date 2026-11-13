import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DripModule } from '../drip/drip.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { MarketModule } from '../market/market.module';
import { NewsModule } from '../news/news.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { CompanyResearchService } from './company/company-research.service';
import { ResearchController } from './research.controller';
import { ResearchRepository } from './research.repository';
import { ResearchService } from './research.service';

@Module({
  imports: [
    AuthModule,
    DripModule,
    IntelligenceModule,
    MarketModule,
    NewsModule,
    PortfolioModule,
  ],
  controllers: [ResearchController],
  providers: [ResearchRepository, CompanyResearchService, ResearchService],
  exports: [ResearchService],
})
export class ResearchModule {}
