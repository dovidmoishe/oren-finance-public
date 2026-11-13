import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WithdrawalService, type WithdrawalInput } from './withdrawal.service';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { WalletAddressPipe } from '../common/pipes/wallet-address.pipe';
import { WithdrawalStocksService } from './withdrawal-stocks.service';

class PrepareWithdrawalDto implements WithdrawalInput {
  @IsString() @MinLength(32) @MaxLength(44) wallet!: string;
  @IsString() @MinLength(32) @MaxLength(44) recipient!: string;
  @IsIn(['USDC', 'SOL', 'STOCK']) asset!: 'USDC' | 'SOL' | 'STOCK';
  @IsOptional() @IsString() @MinLength(32) @MaxLength(44) mint?: string;
  @IsString() @MinLength(1) @MaxLength(30) amount!: string;
  @IsUUID('4') requestId!: string;
}

@Controller('execution/withdrawals')
export class WithdrawalController {
  constructor(
    private readonly withdrawals: WithdrawalService,
    private readonly stocks: WithdrawalStocksService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  @Get('stocks/:wallet')
  @Header('Cache-Control', 'no-store')
  async holdings(
    @Headers('authorization') auth: string | undefined,
    @Param('wallet', WalletAddressPipe) wallet: string,
  ) {
    await this.auth.requireWallet(auth, wallet);
    return this.stocks.list(wallet);
  }

  @Post('prepare')
  @Header('Cache-Control', 'no-store')
  prepare(
    @Headers('authorization') auth: string | undefined,
    @Body() body: PrepareWithdrawalDto,
  ) {
    return this.withdrawals.prepare(auth, body);
  }
}
