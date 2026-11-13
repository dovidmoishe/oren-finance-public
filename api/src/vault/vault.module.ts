import { Module } from '@nestjs/common';
import { AlchemyModule } from '../alchemy/alchemy.module';
import { AuthModule } from '../auth/auth.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TokensModule } from '../tokens/tokens.module';
import { VaultController } from './vault.controller';
import { VaultRepository } from './vault.repository';
import { VaultService } from './vault.service';
import { VaultTransactionBuilder } from './vault-transaction.builder';

@Module({
  imports: [AlchemyModule, AuthModule, PortfolioModule, TokensModule],
  controllers: [VaultController],
  providers: [VaultRepository, VaultTransactionBuilder, VaultService],
  exports: [VaultService, VaultRepository],
})
export class VaultModule {}
