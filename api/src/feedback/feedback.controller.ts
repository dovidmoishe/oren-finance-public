import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Query,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { FeedbackService } from './feedback.service';

@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  @Post()
  async submit(
    @Query('walletAddress') walletAddress: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    return this.feedback.submit(identity, body);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query('walletAddress') walletAddress: string,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    return this.feedback.list(identity.userId);
  }
}

function requiredWallet(value: string | undefined): string {
  if (!value?.trim())
    throw new BadRequestException('walletAddress is required');
  return value.trim();
}
