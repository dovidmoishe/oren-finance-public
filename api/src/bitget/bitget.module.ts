import { Module } from '@nestjs/common';
import { BitgetService } from './bitget.service';

@Module({
  providers: [BitgetService],
  exports: [BitgetService],
})
export class BitgetModule {}
