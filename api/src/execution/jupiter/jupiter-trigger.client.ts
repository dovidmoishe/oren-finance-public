import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import {
  JupiterBadRequestError,
  JupiterUnavailableError,
} from '../../common/errors/provider.errors';
import type {
  JupiterTriggerCancelOrderRequest,
  JupiterTriggerCancelOrderResponse,
  JupiterTriggerCreateOrderRequest,
  JupiterTriggerCreateOrderResponse,
  JupiterTriggerExecuteRequest,
  JupiterTriggerExecuteResponse,
  JupiterTriggerOrdersResponse,
} from './jupiter-trigger.types';
import type { RateLane } from '../../common/rate-limiter';
import { JupiterGateway } from './jupiter-gateway';

@Injectable()
export class JupiterTriggerClient {
  private readonly logger = new Logger(JupiterTriggerClient.name);
  private readonly baseUrl: string;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    private readonly gateway: JupiterGateway,
  ) {
    this.baseUrl = (
      env.JUPITER_TRIGGER_API_URL ??
      deriveTriggerBase(env.JUPITER_API_URL) ??
      'https://api.jup.ag/trigger/v1'
    ).replace(/\/$/, '');
  }

  async createOrder(
    body: JupiterTriggerCreateOrderRequest,
  ): Promise<JupiterTriggerCreateOrderResponse> {
    return this.request<JupiterTriggerCreateOrderResponse>(
      `${this.baseUrl}/createOrder`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  async execute(
    body: JupiterTriggerExecuteRequest,
  ): Promise<JupiterTriggerExecuteResponse> {
    return this.request<JupiterTriggerExecuteResponse>(
      `${this.baseUrl}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  async cancelOrder(
    body: JupiterTriggerCancelOrderRequest,
  ): Promise<JupiterTriggerCancelOrderResponse> {
    return this.request<JupiterTriggerCancelOrderResponse>(
      `${this.baseUrl}/cancelOrder`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  async getTriggerOrders(params: {
    user: string;
    orderStatus: 'active' | 'history';
    page?: number;
    inputMint?: string;
    outputMint?: string;
    /** 'background' for pollers so they cannot starve user requests. */
    lane?: RateLane;
  }): Promise<JupiterTriggerOrdersResponse> {
    const url = new URL(`${this.baseUrl}/getTriggerOrders`);
    url.searchParams.set('user', params.user);
    url.searchParams.set('orderStatus', params.orderStatus);
    if (params.page !== undefined) {
      url.searchParams.set('page', String(params.page));
    }
    if (params.inputMint) {
      url.searchParams.set('inputMint', params.inputMint);
    }
    if (params.outputMint) {
      url.searchParams.set('outputMint', params.outputMint);
    }
    return this.request<JupiterTriggerOrdersResponse>(
      url.toString(),
      { method: 'GET' },
      params.lane,
    );
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    lane: RateLane = 'priority',
  ): Promise<T> {
    const response = await this.gateway.fetch(
      url,
      init,
      'Jupiter Trigger',
      lane,
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    if (response.ok) {
      return payload as T;
    }

    const detail =
      typeof payload === 'object' && payload !== null
        ? JSON.stringify(payload).slice(0, 300)
        : response.statusText;
    this.logger.warn(
      `Jupiter Trigger HTTP ${response.status}: ${detail.slice(0, 200)}`,
    );

    if (response.status === 400 || response.status === 422) {
      throw new JupiterBadRequestError(
        `Jupiter Trigger rejected request: ${detail || response.statusText}`,
      );
    }

    throw new JupiterUnavailableError(
      `Jupiter Trigger HTTP ${response.status}: ${detail || response.statusText}`,
    );
  }
}

function deriveTriggerBase(swapUrl?: string): string | undefined {
  if (!swapUrl) return undefined;
  try {
    const parsed = new URL(swapUrl);
    return `${parsed.origin}/trigger/v1`;
  } catch {
    return undefined;
  }
}
