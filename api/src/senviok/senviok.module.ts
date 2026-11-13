import { Global, Module } from '@nestjs/common';
import { SenviokEmailService } from './senviok.service';

@Global()
@Module({
  providers: [SenviokEmailService],
  exports: [SenviokEmailService],
})
export class SenviokModule {}
