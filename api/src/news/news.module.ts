import { Module } from '@nestjs/common';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TokensModule } from '../tokens/tokens.module';
import { NewsController } from './news.controller';
import { NewsRepository } from './news.repository';
import { NewsService } from './news.service';

@Module({
  imports: [TokensModule, PortfolioModule],
  controllers: [NewsController],
  providers: [NewsRepository, NewsService],
  exports: [NewsService, NewsRepository],
})
export class NewsModule {}
