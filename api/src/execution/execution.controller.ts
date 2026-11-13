import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type {
  PostBasketRequest,
  PostBasketResponse,
  PostExecutionConfirmRequest,
  PostExecutionConfirmResponse,
  PostExecutionPrepareRequest,
  PostExecutionPrepareResponse,
  PostExecutionQuoteResponse,
} from '../../types/api';
import type {
  BasketCandidate,
  PreparedBasketPurchase,
  QuoteRequest,
  TradeIntent,
} from '../../types/execution';
import type {
  LimitOrderIntent,
  LimitOrderProposal,
  LimitOrderRecord,
  PreparedLimitCancel,
  PreparedLimitOrder,
} from '../../types/limit-order';
import type { TradeSide } from '../../types/quote';
import type { LimitZoneBasis } from '../../types/analysis';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { ExecutionService } from './execution.service';
import { publicQuote } from './swap-terms';

/** Accepts either TradeIntent or mint-level QuoteRequest fields. */
class ExecutionQuoteDto {
  @IsIn(['buy', 'sell'])
  side!: TradeSide;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  ticker?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  amountUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  amount?: number;

  @IsOptional()
  @IsString()
  preferredMint?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  slippageBps?: number;

  @IsOptional()
  @IsString()
  inputMint?: string;

  @IsOptional()
  @IsString()
  outputMint?: string;

  @IsOptional()
  @IsString()
  wallet?: string;

  @IsOptional()
  @IsBoolean()
  autoRefresh?: boolean;
}

class ExecutionPrepareDto implements PostExecutionPrepareRequest {
  @IsString()
  @MinLength(1)
  quoteId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;
}

class ExecutionConfirmDto implements PostExecutionConfirmRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  executionId?: string;

  @IsString()
  @MinLength(1)
  quoteId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

class BasketCandidateDto {
  @IsString()
  @MinLength(1)
  assetId!: string;

  @IsString()
  @MinLength(1)
  ticker!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0)
  opportunityScore!: number;
}

class BasketCreateDto implements PostBasketRequest {
  @IsNumber()
  @Min(0.000001)
  amountUsd!: number;

  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsOptional()
  @IsString()
  wallet?: string;

  @IsOptional()
  candidates?: BasketCandidateDto[];
}

class BasketPrepareDto {
  @IsString()
  @MinLength(1)
  basketId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;
}

class LimitOrderProposeDto implements LimitOrderIntent {
  @IsIn(['buy', 'sell'])
  side!: TradeSide;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsString()
  @MinLength(1)
  ticker!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  amountUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  amount?: number;

  @IsNumber()
  @Min(0.000001)
  limitPriceUsd!: number;

  @IsOptional()
  @IsString()
  preferredMint?: string;

  @IsOptional()
  @IsNumber()
  expiredAt?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  slippageBps?: number;

  @IsOptional()
  @IsString()
  wallet?: string;

  @IsOptional()
  @IsString()
  basis?: LimitZoneBasis;
}

class LimitOrderPrepareDto {
  @IsString()
  @MinLength(1)
  proposalId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;
}

class LimitOrderConfirmDto {
  @IsString()
  @MinLength(1)
  proposalId!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  signature!: string;

  @IsOptional()
  @IsString()
  orderKey?: string;
}

class LimitOrderCancelPrepareDto {
  @IsString()
  @MinLength(1)
  orderKey!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;
}

class LimitOrderCancelConfirmDto {
  @IsString()
  @MinLength(1)
  orderKey!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

@Controller('execution')
export class ExecutionController {
  constructor(
    private readonly execution: ExecutionService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  @Post('quote')
  async quote(
    @Body() body: ExecutionQuoteDto,
  ): Promise<PostExecutionQuoteResponse> {
    // Route payloads (instructions, lookup tables) stay server-side, keyed
    // by quote id in the QuoteCache; clients only ever send the id back.
    return publicQuote(
      await this.execution.getQuote(body as TradeIntent | QuoteRequest),
    );
  }

  @Post('prepare')
  async prepare(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ExecutionPrepareDto,
  ): Promise<PostExecutionPrepareResponse> {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.execution.prepare(body);
  }

  @Post('confirm')
  async confirm(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ExecutionConfirmDto,
  ): Promise<PostExecutionConfirmResponse> {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.execution.confirm(body);
  }

  @Get(':executionId/status')
  status(@Param('executionId') executionId: string) {
    return this.execution.getExecutionStatus(executionId);
  }

  @Post('basket')
  basket(@Body() body: BasketCreateDto): Promise<PostBasketResponse> {
    return this.execution.createBasket({
      ...body,
      candidates: body.candidates as BasketCandidate[] | undefined,
    });
  }

  @Post('basket/prepare')
  prepareBasket(
    @Body() body: BasketPrepareDto,
  ): Promise<PreparedBasketPurchase> {
    return this.execution.prepareBasketPurchase(body);
  }

  @Post('limit-order')
  proposeLimitOrder(
    @Body() body: LimitOrderProposeDto,
  ): Promise<LimitOrderProposal> {
    return this.execution.proposeLimitOrder(body);
  }

  @Post('limit-order/prepare')
  async prepareLimitOrder(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: LimitOrderPrepareDto,
  ): Promise<PreparedLimitOrder> {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.execution.prepareLimitOrder(body);
  }

  @Post('limit-order/confirm')
  async confirmLimitOrder(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: LimitOrderConfirmDto,
  ) {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.execution.confirmLimitOrder(body);
  }

  @Get('limit-orders/:wallet')
  listLimitOrders(
    @Param('wallet') wallet: string,
    @Query('includeHistory') includeHistory?: string,
  ): Promise<LimitOrderRecord[]> {
    return this.execution.listLimitOrders(wallet, {
      includeHistory: includeHistory === 'true' || includeHistory === '1',
    });
  }

  @Post('limit-order/prepare-cancel')
  async prepareCancelLimitOrder(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: LimitOrderCancelPrepareDto,
  ): Promise<PreparedLimitCancel> {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.execution.prepareCancelLimitOrder(body);
  }

  @Post('limit-order/confirm-cancel')
  async confirmCancelLimitOrder(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: LimitOrderCancelConfirmDto,
  ) {
    await this.auth.requireWallet(authorization, body.wallet);
    return this.execution.confirmCancelLimitOrder(body);
  }
}
