import { Type } from 'class-transformer';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import type {
  GetAgentThreadMessagesResponse,
  PostAgentMessageRequest,
  PostAgentMessageResponse,
} from '../../types/api';
import type { AgentPage } from '../../types/agent';
import { AgentService } from './agent.service';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { AgentUsageLimit } from '../common/rate-limit';

/** Keeps each turn's model input bounded; the app composer enforces the same cap. */
export const AGENT_MESSAGE_MAX_LENGTH = 4_000;

const AGENT_PAGES: AgentPage[] = [
  'dashboard',
  'calendar',
  'leaderboard',
  'markets',
  'stock',
  'vault',
  'activity',
];

class AgentPageContextDto {
  @IsIn(AGENT_PAGES)
  page!: AgentPage;

  @IsOptional()
  @IsString()
  @MinLength(1)
  assetId?: string;
}

class AgentMessageDto implements PostAgentMessageRequest {
  @IsString()
  @MinLength(1)
  walletAddress!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  threadId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_MESSAGE_MAX_LENGTH)
  message!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentPageContextDto)
  context?: AgentPageContextDto;
}

class AgentHistoryQueryDto {
  @IsString()
  @MinLength(1)
  walletAddress!: string;
}

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly auth: PrivyWalletAuth,
    private readonly usage: AgentUsageLimit = new AgentUsageLimit(),
  ) {}

  @Post('message')
  async message(
    @Body() body: AgentMessageDto,
    @Headers('authorization') authorization?: string,
  ): Promise<PostAgentMessageResponse> {
    await this.auth.requireWallet(authorization, body.walletAddress);
    this.usage.assertAllowed(body.walletAddress);
    return this.agent.message(body, authorization);
  }

  @Post('message/stream')
  async streamMessage(
    @Body() body: AgentMessageDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.auth.requireWallet(
      request.headers.authorization,
      body.walletAddress,
    );
    this.usage.assertAllowed(body.walletAddress, response);
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.write(': connected\n\n');

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    response.on('close', onClose);
    request.on('aborted', onClose);
    const keepAlive = setInterval(() => {
      if (!response.writableEnded && !response.destroyed) {
        response.write(': keepalive\n\n');
      }
    }, 15_000);

    try {
      for await (const event of this.agent.streamMessage(
        body,
        abortController.signal,
        request.headers.authorization,
      )) {
        if (response.writableEnded || response.destroyed) break;
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      clearInterval(keepAlive);
      response.off('close', onClose);
      request.off('aborted', onClose);
      if (!response.writableEnded && !response.destroyed) response.end();
    }
  }

  @Get('threads/:threadId/messages')
  async getThreadMessages(
    @Param('threadId') threadId: string,
    @Query() query: AgentHistoryQueryDto,
    @Headers('authorization') authorization?: string,
  ): Promise<GetAgentThreadMessagesResponse> {
    await this.auth.requireWallet(authorization, query.walletAddress);
    return this.agent.getThreadMessages(threadId, query.walletAddress);
  }
}
