import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BitgetModule } from '../bitget/bitget.module';
import { DripModule } from '../drip/drip.module';
import { ExecutionModule } from '../execution/execution.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { MarketModule } from '../market/market.module';
import { NewsModule } from '../news/news.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ResearchModule } from '../research/research.module';
import { SocialModule } from '../social/social.module';
import { VaultModule } from '../vault/vault.module';
import { AgentController } from './agent.controller';
import { AgentRepository } from './agent.repository';
import { AgentService } from './agent.service';
import { CompanyBriefService } from './company-brief.service';
import { openAiClientProvider } from './openai.provider';
import { AgentToolRegistry } from './tools/agent-tool.registry';
import { AgentUsageLimit, PaidProviderToolBudget } from '../common/rate-limit';

@Module({
  imports: [
    AuthModule,
    BitgetModule,
    DripModule,
    PortfolioModule,
    ResearchModule,
    MarketModule,
    NewsModule,
    IntelligenceModule,
    ExecutionModule,
    VaultModule,
    SocialModule,
  ],
  controllers: [AgentController],
  providers: [
    openAiClientProvider,
    AgentRepository,
    AgentToolRegistry,
    AgentService,
    CompanyBriefService,
    AgentUsageLimit,
    PaidProviderToolBudget,
  ],
  exports: [AgentService, AgentToolRegistry],
})
export class AgentModule {}
