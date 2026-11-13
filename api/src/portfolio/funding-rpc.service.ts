import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { APP_ENV, USDC_MINT } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { decimalAmount, type FundingSnapshot } from './funding.types';

interface ContextValue<T> {
  context: { slot: number };
  value: T;
}
interface TokenAccount {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: { amount: string; decimals: number };
        };
      };
    };
  };
}

@Injectable()
export class FundingRpc {
  constructor(
    private readonly client: AlchemyClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  get websocketUrl(): string {
    this.requireMainnet();
    const url =
      this.env.ALCHEMY_SOLANA_WS_URL ??
      `wss://solana-mainnet.streaming.alchemy.com/v2/${this.env.ALCHEMY_API_KEY}`;
    if (!url.startsWith('wss://'))
      throw new ServiceUnavailableException(
        'Secure funding updates are not configured',
      );
    return url;
  }

  associatedAccount(wallet: string): string {
    return getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(wallet),
    ).toBase58();
  }

  async snapshot(
    wallet: string,
    minContextSlot = 0,
    signal?: AbortSignal,
  ): Promise<{ data: FundingSnapshot; accounts: string[] }> {
    this.requireMainnet();
    const config = { commitment: 'confirmed', minContextSlot };
    const [sol, usdc] = await Promise.all([
      this.client.call<ContextValue<number>>(
        'getBalance',
        [wallet, config],
        signal,
      ),
      this.client.call<ContextValue<TokenAccount[]>>(
        'getTokenAccountsByOwner',
        [wallet, { mint: USDC_MINT }, { ...config, encoding: 'jsonParsed' }],
        signal,
      ),
    ]).catch(() => {
      throw new ServiceUnavailableException(
        'Unable to verify funding balances',
      );
    });
    if (
      !Number.isSafeInteger(sol?.value) ||
      sol.value < 0 ||
      !Array.isArray(usdc?.value) ||
      !Number.isSafeInteger(sol?.context?.slot) ||
      !Number.isSafeInteger(usdc?.context?.slot) ||
      sol.context.slot < minContextSlot ||
      usdc.context.slot < minContextSlot ||
      usdc.value.length > 64
    ) {
      throw new ServiceUnavailableException(
        'Unable to verify funding balances',
      );
    }
    let usdcAtomic = 0n;
    const accounts = new Set<string>([this.associatedAccount(wallet)]);
    const seen = new Set<string>();
    for (const item of usdc.value) {
      const info = item.account?.data?.parsed?.info;
      if (
        info?.mint !== USDC_MINT ||
        info.owner !== wallet ||
        info.tokenAmount?.decimals !== 6 ||
        !/^\d+$/.test(info.tokenAmount.amount) ||
        info.tokenAmount.amount.length > 20 ||
        !item.pubkey ||
        seen.has(item.pubkey)
      ) {
        throw new ServiceUnavailableException('Unable to verify USDC balances');
      }
      if (BigInt(info.tokenAmount.amount) > 18446744073709551615n)
        throw new ServiceUnavailableException('Unable to verify USDC balances');
      usdcAtomic += BigInt(info.tokenAmount.amount);
      seen.add(item.pubkey);
      accounts.add(item.pubkey);
    }
    return {
      accounts: [...accounts],
      data: {
        wallet,
        network: 'mainnet',
        commitment: 'confirmed',
        usdcMint: USDC_MINT,
        solLamports: String(sol.value),
        usdcAtomic: String(usdcAtomic),
        sol: decimalAmount(BigInt(sol.value), 9),
        usdc: decimalAmount(usdcAtomic, 6),
        slot: Math.min(sol.context.slot, usdc.context.slot),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  private requireMainnet() {
    if (this.env.SOLANA_NETWORK !== 'mainnet')
      throw new ServiceUnavailableException(
        'Deposits are available on Solana mainnet only',
      );
  }
}
