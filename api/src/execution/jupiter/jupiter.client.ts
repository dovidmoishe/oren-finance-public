import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import {
  JupiterBadRequestError,
  JupiterUnavailableError,
} from '../../common/errors/provider.errors';
import type { RateLane } from '../../common/rate-limiter';
import { JupiterGateway } from './jupiter-gateway';
import type { JupiterQuoteRaw, JupiterSwapRaw } from './jupiter.types';

@Injectable()
export class JupiterClient {
  private readonly logger = new Logger(JupiterClient.name);
  private readonly baseUrl: string;
  private readonly trackingAccount?: string;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    private readonly gateway: JupiterGateway,
  ) {
    this.baseUrl = (
      env.JUPITER_API_URL ?? 'https://api.jup.ag/swap/v1'
    ).replace(/\/$/, '');
    this.trackingAccount = env.JUPITER_TRACKING_ACCOUNT;
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
    /** 'background' for quotes no user is waiting on (auto-refresh). */
    lane?: RateLane;
  }): Promise<JupiterQuoteRaw> {
    const url = new URL(`${this.baseUrl}/quote`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount);
    url.searchParams.set('slippageBps', String(params.slippageBps));

    return this.request<JupiterQuoteRaw>(
      url.toString(),
      { method: 'GET' },
      params.lane,
    );
  }

  async postSwap(body: {
    quoteResponse: JupiterQuoteRaw;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    dynamicComputeUnitLimit?: boolean;
    useSharedAccounts?: boolean;
    /** null explicitly disables the configured integrator marker. */
    trackingAccount?: string | null;
  }): Promise<JupiterSwapRaw> {
    return this.request<JupiterSwapRaw>(`${this.baseUrl}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: body.quoteResponse,
        userPublicKey: body.userPublicKey,
        wrapAndUnwrapSol: body.wrapAndUnwrapSol ?? true,
        dynamicComputeUnitLimit: body.dynamicComputeUnitLimit ?? true,
        useSharedAccounts: body.useSharedAccounts,
        trackingAccount:
          body.trackingAccount === null
            ? undefined
            : body.trackingAccount ?? this.trackingAccount,
      }),
    });
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    lane: RateLane = 'priority',
  ): Promise<T> {
    const response = await this.gateway.fetch(url, init, 'Jupiter', lane);

    if (response.ok) {
      return (await response.json()) as T;
    }

    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = response.statusText;
    }
    this.logger.warn(`Jupiter HTTP ${response.status}: ${detail.slice(0, 200)}`);

    if (response.status === 400 || response.status === 422) {
      throw new JupiterBadRequestError(
        `Jupiter rejected request: ${detail || response.statusText}`,
      );
    }

    throw new JupiterUnavailableError(
      `Jupiter HTTP ${response.status}: ${detail || response.statusText}`,
    );
  }
}
