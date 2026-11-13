import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { ResearchService } from './research.service';

@Controller('research')
export class ResearchController {
  constructor(
    private readonly research: ResearchService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  @Get('stocks/:assetId')
  async getStock(
    @Param('assetId') assetId: string,
    @Query('walletAddress') walletAddress: string,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    return this.research.getStock(assetId, identity);
  }

  @Get('saved')
  async list(
    @Query('walletAddress') walletAddress: string,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    return this.research.listSaved(identity.userId);
  }

  @Post('source-open/:assetId')
  async sourceOpen(
    @Param('assetId') assetId: string,
    @Query('walletAddress') walletAddress: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(assetId)) {
      throw new BadRequestException('Invalid assetId');
    }
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    await this.research.recordSourceOpen(identity.userId, assetId);
    return { recorded: true };
  }

  @Put('saved/:assetId')
  async save(
    @Param('assetId') assetId: string,
    @Query('walletAddress') walletAddress: string,
    @Body() body: { note?: unknown },
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    const note = requiredNote(body?.note);
    const report = await this.research.getStock(assetId, identity);
    return this.research.save(report, identity.userId, note);
  }

  @Patch('saved/:assetId')
  async update(
    @Param('assetId') assetId: string,
    @Query('walletAddress') walletAddress: string,
    @Body() body: { note?: unknown },
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    const saved = await this.research.updateNote(
      identity.userId,
      assetId,
      requiredNote(body?.note),
    );
    if (!saved) throw new BadRequestException('Saved thesis not found');
    return saved;
  }

  @Delete('saved/:assetId')
  async remove(
    @Param('assetId') assetId: string,
    @Query('walletAddress') walletAddress: string,
    @Headers('authorization') authorization?: string,
  ) {
    const identity = await this.auth.requireResearchIdentity(
      authorization,
      requiredWallet(walletAddress),
    );
    await this.research.remove(identity.userId, assetId);
    return { removed: true };
  }
}

function requiredWallet(value: string | undefined): string {
  if (!value?.trim())
    throw new BadRequestException('walletAddress is required');
  return value.trim();
}

function requiredNote(value: unknown): string {
  if (typeof value !== 'string')
    throw new BadRequestException('note is required');
  const note = value.trim();
  if (!note || note.length > 2000)
    throw new BadRequestException('note must be 1–2000 characters');
  return note;
}
