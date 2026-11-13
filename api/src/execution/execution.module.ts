import { Module } from '@nestjs/common';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalStocksService } from './withdrawal-stocks.service';
import { AuthModule } from '../auth/auth.module';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { ApprovalRepository } from './approval.repository';
import { ApprovalRpc } from './approval-rpc.service';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TokensModule } from '../tokens/tokens.module';
import { BasketCache } from './basket-cache';
import { ExecutionController } from './execution.controller';
import { ExecutionRepository } from './execution.repository';
import { ExecutionService } from './execution.service';
import { JupiterClient } from './jupiter/jupiter.client';
import { JupiterGateway } from './jupiter/jupiter-gateway';
import { JupiterService } from './jupiter/jupiter.service';
import { JupiterTriggerClient } from './jupiter/jupiter-trigger.client';
import { LimitOrderCache } from './limit-order-cache';
import { LimitOrderRepository } from './limit-order.repository';
import { QuoteCache } from './quote-cache';
import { SwapFeeOracle } from './swap-fee-oracle';
import { SwapRouter } from './swap-router';
import { TitanClient } from './titan/titan.client';
import { TitanService } from './titan/titan.service';
import { TitanTxBuilder } from './titan/titan-tx.builder';
import { VariantSelector } from './variant-selector';
import { StockDecimals } from './stock-decimals';
import { LimitOrderFillPoller } from './limit-order-fill.poller';
import { OnchainTransactions } from './onchain-transaction';

@Module({
  imports: [
    AuthModule,
    AlchemyModule,
    TokensModule,
    PortfolioModule,
    IntelligenceModule,
    AnalyticsModule,
  ],
  controllers: [ExecutionController, ApprovalController, WithdrawalController],
  providers: [
    WithdrawalService,
    WithdrawalStocksService,
    ApprovalService,
    ApprovalRepository,
    ApprovalRpc,
    BasketCache,
    LimitOrderCache,
    JupiterGateway,
    JupiterClient,
    JupiterTriggerClient,
    JupiterService,
    TitanClient,
    TitanTxBuilder,
    TitanService,
    SwapFeeOracle,
    SwapRouter,
    QuoteCache,
    VariantSelector,
    StockDecimals,
    ExecutionRepository,
    LimitOrderRepository,
    ExecutionService,
    LimitOrderFillPoller,
    OnchainTransactions,
  ],
  exports: [ExecutionService, JupiterService, SwapRouter],
})
export class ExecutionModule {}
