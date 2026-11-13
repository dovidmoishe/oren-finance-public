import {
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { WalletAddressPipe } from '../common/pipes/wallet-address.pipe';
import { FundingService } from './funding.service';

@Controller('portfolio')
export class FundingController {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly funding: FundingService,
  ) {}

  @Get(':wallet/funding')
  @Header('Cache-Control', 'no-store')
  async snapshot(
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.auth.requireWallet(authorization, wallet);
    return this.funding.snapshot(wallet);
  }

  @Get(':wallet/funding/stream')
  async stream(
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.auth.requireWallet(request.headers.authorization, wallet);
    if (request.aborted || response.destroyed) return;
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const subscription = this.funding.observe(wallet).subscribe({
      next: (event) => {
        if (response.writableEnded || response.destroyed) return;
        if (!response.write(`data: ${JSON.stringify(event)}\n\n`))
          response.end();
      },
      error: () => {
        if (!response.writableEnded)
          response.end(
            'data: {"type":"error","message":"Unable to load live balances. Please retry."}\n\n',
          );
      },
      complete: () => {
        if (!response.writableEnded) response.end();
      },
    });
    const keepalive = setInterval(() => {
      if (response.writableEnded || response.destroyed) return;
      if (!response.write(': heartbeat\n\n')) response.end();
    }, 20_000);
    // Bound authorization lifetime. The reconnect uses a fresh token and wallet
    // ownership verification; this timer never requests a balance.
    const expiry = setTimeout(() => response.end(), 4 * 60_000);
    const close = () => {
      clearInterval(keepalive);
      clearTimeout(expiry);
      subscription.unsubscribe();
    };
    response.once('close', close);
    if (response.writableEnded || response.destroyed) close();
  }
}
