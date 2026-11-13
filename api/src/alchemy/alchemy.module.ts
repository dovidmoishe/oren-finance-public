import { Module } from '@nestjs/common';
import { AlchemyClient } from './alchemy.client';
import { AlchemyService } from './alchemy.service';

@Module({
  providers: [AlchemyClient, AlchemyService],
  exports: [AlchemyService, AlchemyClient],
})
export class AlchemyModule {}
