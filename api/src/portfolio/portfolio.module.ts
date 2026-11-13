import { Module } from '@nestjs/common';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { TokensModule } from '../tokens/tokens.module';
import { AuthModule } from '../auth/auth.module';
import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { FundingRpc } from './funding-rpc.service';
import { PortfolioController } from './portfolio.controller';
import { PortfolioCalendarService } from './portfolio-calendar.service';
import { PortfolioRepository } from './portfolio.repository';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [AlchemyModule, TokensModule, AuthModule],
  controllers: [PortfolioController, FundingController],
  providers: [PortfolioRepository, PortfolioService, PortfolioCalendarService, FundingRpc, FundingService],
  exports: [PortfolioService, PortfolioRepository, PortfolioCalendarService],
})
export class PortfolioModule {}
