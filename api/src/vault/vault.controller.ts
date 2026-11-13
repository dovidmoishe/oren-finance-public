import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type {
  GetVaultsResponse,
  PostConfirmLockRequest,
  PostConfirmLockResponse,
  PostConfirmUnlockRequest,
  PostConfirmUnlockResponse,
  PostPrepareLockRequest,
  PostPrepareLockResponse,
  PostPrepareUnlockRequest,
  PostPrepareUnlockResponse,
} from '../../types/api';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { VaultService } from './vault.service';

class PrepareLockDto implements PostPrepareLockRequest {
  @IsIn(['lock'])
  action!: 'lock';

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  asset!: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  mint?: string;

  @IsNumber()
  @Min(0.000001)
  amount!: number;

  @Type(() => Date)
  @IsDate()
  unlockAt!: Date;
}

class PrepareUnlockDto implements PostPrepareUnlockRequest {
  @IsIn(['unlock'])
  action!: 'unlock';

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(32)
  lockAddress!: string;
}

class ConfirmLockDto implements PostConfirmLockRequest {
  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  signature!: string;

  @IsString()
  @MinLength(32)
  lockAddress!: string;

  @IsString()
  @MinLength(32)
  mint!: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  ticker?: string;

  @IsNumber()
  @Min(0.000001)
  amount!: number;

  @Type(() => Date)
  @IsDate()
  unlockAt!: Date;
}

class ConfirmUnlockDto implements PostConfirmUnlockRequest {
  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  signature!: string;

  @IsString()
  @MinLength(32)
  lockAddress!: string;
}

@Controller('vaults')
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  @Get(':wallet')
  list(@Param('wallet') wallet: string): Promise<GetVaultsResponse> {
    return this.vault.listVaults(wallet);
  }

  @Post('prepare-lock')
  prepareLock(
    @Body() body: PrepareLockDto,
  ): Promise<PostPrepareLockResponse> {
    return this.vault.prepareLock(body);
  }

  @Post('prepare-unlock')
  prepareUnlock(
    @Body() body: PrepareUnlockDto,
  ): Promise<PostPrepareUnlockResponse> {
    return this.vault.prepareUnlock(body);
  }

  @Post('confirm-lock')
  async confirmLock(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ConfirmLockDto,
  ): Promise<PostConfirmLockResponse> {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.vault.confirmLock(body);
  }

  @Post('confirm-unlock')
  async confirmUnlock(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ConfirmUnlockDto,
  ): Promise<PostConfirmUnlockResponse> {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.vault.confirmUnlock(body);
  }
}
