import { assertFinancialExecutionEnabled } from '../config/deployment';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { AlchemyUnavailableError } from '../common/errors/provider.errors';
import type { AlchemyRpcResponse } from './alchemy.types';

@Injectable()
export class AlchemyClient {
  private readonly logger = new Logger(AlchemyClient.name);
  private readonly rpcUrl: string;
  private id = 1;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    const network =
      env.SOLANA_NETWORK === 'devnet' ? 'solana-devnet' : 'solana-mainnet';
    this.rpcUrl = `https://${network}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  }

  get endpoint(): string {
    return this.rpcUrl.replace(/\/[^/]+$/, '/***');
  }

  async call<T>(
    method: string,
    params: unknown[],
    signal?: AbortSignal,
  ): Promise<T> {
    if (method === 'sendTransaction' || method === 'sendRawTransaction') assertFinancialExecutionEnabled();
    let response: Response;
    try {
      response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.id++,
          method,
          params,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new AlchemyUnavailableError('Alchemy network error', err);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AlchemyUnavailableError(
        `Alchemy HTTP ${response.status}: ${text || response.statusText}`,
      );
    }

    const body = (await response.json()) as AlchemyRpcResponse<T>;
    if (body.error) {
      this.logger.warn(
        `Alchemy RPC error ${body.error.code}: ${body.error.message}`,
      );
      throw new AlchemyUnavailableError(body.error.message, body.error);
    }

    return body.result as T;
  }
}
