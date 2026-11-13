import { Module } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { WalletAddressPipe } from './pipes/wallet-address.pipe';

@Module({
  providers: [HttpExceptionFilter, WalletAddressPipe],
  exports: [HttpExceptionFilter, WalletAddressPipe],
})
export class CommonModule {}
