import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  GetSocialLeaderboardResponse,
  GetSocialTraderResponse,
  PostSocialCopyPortfolioPrepareRequest,
  PostSocialCopyPortfolioPrepareResponse,
  PostSocialProfileVisibilityChallengeRequest,
  PostSocialProfileVisibilityChallengeResponse,
  PostSocialProfileVisibilityRequest,
  PostSocialProfileVisibilityResponse,
} from '../../types/api';
import type { SocialTimeframe } from '../../types/social';
import { WalletAddressPipe } from '../common/pipes/wallet-address.pipe';
import { SocialService } from './social.service';

class LeaderboardQueryDto {
  @IsOptional()
  @IsString()
  timeframe?: SocialTimeframe;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

class TraderVisibilityChallengeDto implements PostSocialProfileVisibilityChallengeRequest {
  @IsBoolean()
  isPublic!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;
}

class TraderVisibilityDto implements PostSocialProfileVisibilityRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  message!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  signature!: string;
}

class CopyPortfolioDto implements PostSocialCopyPortfolioPrepareRequest {
  @IsString()
  @MinLength(1)
  sourceSlug!: string;

  @IsString()
  @MinLength(32)
  wallet!: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0.000001)
  amountUsd!: number;
}

@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('leaderboard')
  getLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<GetSocialLeaderboardResponse> {
    return this.social.getLeaderboard(query);
  }

  @Get('traders/:slug')
  getTrader(
    @Param('slug') slug: string,
    @Query('timeframe') timeframe?: SocialTimeframe,
  ): Promise<GetSocialTraderResponse> {
    return this.social.getTraderDetail(slug, timeframe);
  }

  @Post('profiles/:wallet/visibility/challenge')
  createVisibilityChallenge(
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Body() body: TraderVisibilityChallengeDto,
  ): Promise<PostSocialProfileVisibilityChallengeResponse> {
    return this.social.createVisibilityChallenge(wallet, body);
  }

  @Post('profiles/:wallet/visibility')
  updateVisibility(
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Body() body: TraderVisibilityDto,
  ): Promise<PostSocialProfileVisibilityResponse> {
    return this.social.updateVisibility(wallet, body);
  }

  @Post('copy-portfolio/prepare')
  prepareCopyPortfolio(
    @Body() body: CopyPortfolioDto,
  ): Promise<PostSocialCopyPortfolioPrepareResponse> {
    return this.social.prepareCopyPortfolio(body);
  }
}
