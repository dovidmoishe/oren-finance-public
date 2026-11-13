import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { randomUUID } from 'node:crypto';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { APP_ENV, USDC_MINT } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { assertFinancialExecutionEnabled } from '../config/deployment';
import { ApprovalRepository, type ApprovalRow } from './approval.repository';
import { ApprovalRpc } from './approval-rpc.service';
import {
  WithdrawalStocksService,
  shareAmount,
  scaledShares,
  rawStockShares,
} from './withdrawal-stocks.service';

export interface WithdrawalInput {
  wallet: string;
  recipient: string;
  asset: 'USDC' | 'SOL' | 'STOCK';
  mint?: string;
  amount: string;
  requestId: string;
}

export function withdrawalAmount(
  amount: string,
  asset: 'USDC' | 'SOL' | number,
): bigint {
  const decimals = typeof asset === 'number' ? asset : asset === 'USDC' ? 6 : 9;
  if (
    typeof amount !== 'string' ||
    amount.length > 30 ||
    !new RegExp(
      decimals === 0
        ? '^(0|[1-9]\\d*)$'
        : `^(0|[1-9]\\d*)(\\.\\d{1,${decimals}})?$`,
    ).test(amount)
  )
    throw new BadRequestException(
      `Enter an amount with up to ${decimals} decimal places`,
    );
  const [whole, fraction = ''] = amount.split('.');
  const raw = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (raw <= 0n || raw > 18446744073709551615n)
    throw new BadRequestException('Enter a valid positive amount');
  return raw;
}

function walletKey(value: string) {
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value || !PublicKey.isOnCurve(key.toBytes()))
      throw new Error();
    return key;
  } catch {
    throw new BadRequestException('Enter a valid Solana wallet address');
  }
}

interface TokenAccount {
  pubkey: string;
  account: {
    owner: string;
    data: {
      parsed: {
        info: {
          owner: string;
          mint: string;
          state: string;
          tokenAmount: { amount: string; decimals: number };
        };
      };
    };
  };
}

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly approvals: ApprovalRepository,
    private readonly rpc: AlchemyClient,
    private readonly inspection: ApprovalRpc,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly stocks: WithdrawalStocksService,
  ) {}

  async prepare(authorization: string | undefined, input: WithdrawalInput) {
    assertFinancialExecutionEnabled();
    if (this.env.SOLANA_NETWORK !== 'mainnet')
      throw new ServiceUnavailableException(
        'Transfers are available on Solana mainnet only',
      );
    const owner = await this.auth.requireSigner(authorization, input.wallet);
    if (!['USDC', 'SOL', 'STOCK'].includes(input.asset))
      throw new BadRequestException(
        'Choose USDC, SOL, or a stock token from your holdings',
      );
    if (input.asset !== 'STOCK' && input.mint)
      throw new BadRequestException(
        'Choose a stock before supplying a token mint',
      );
    const stock =
      input.asset === 'STOCK'
        ? await this.stocks.resolve(input.mint)
        : undefined;
    const decimals = stock?.decimals ?? (input.asset === 'USDC' ? 6 : 9);
    const mintAddress = stock?.mint ?? USDC_MINT;
    const programId = stock?.programId ?? TOKEN_PROGRAM_ID;
    const symbol = stock?.symbol ?? input.asset;
    const sender = walletKey(input.wallet);
    const recipient = walletKey(input.recipient);
    if (sender.equals(recipient))
      throw new BadRequestException('Choose a different receiving wallet');
    const requestedRaw = withdrawalAmount(input.amount, decimals);
    const requestedAmount = shareAmount(requestedRaw, decimals);
    const existing = await this.approvals.findReference(
      owner.userId,
      input.wallet,
      'withdrawal',
      input.requestId,
    );
    if (existing) {
      if (
        existing.details.recipient !== input.recipient ||
        existing.details.asset !== input.asset ||
        (existing.details.requestedAmount ?? existing.details.amount) !==
          requestedAmount ||
        (existing.details.mint ?? undefined) !== stock?.mint
      )
        throw new ConflictException(
          'This request already belongs to another transfer',
        );
      return this.view(existing);
    }
    const raw =
      stock?.scaleMultiplier === undefined
        ? requestedRaw
        : rawStockShares(requestedAmount, decimals, stock.scaleMultiplier);
    const amount =
      stock?.scaleMultiplier === undefined
        ? requestedAmount
        : scaledShares(raw, decimals, stock.scaleMultiplier);
    if (withdrawalAmount(amount, decimals) > requestedRaw)
      throw new BadRequestException(
        'This quantity rounds above the requested shares. Enter a slightly smaller quantity.',
      );
    if ((await this.approvals.pending(owner.userId, input.wallet)).length)
      throw new ConflictException(
        'Check your pending transaction before preparing another transfer',
      );

    const [balance, destination, latest] = await Promise.all([
      this.rpc.call<{ value: number }>('getBalance', [
        input.wallet,
        { commitment: 'confirmed' },
      ]),
      this.rpc.call<{
        value: {
          owner: string;
          executable: boolean;
          data: [string, string];
        } | null;
      }>('getAccountInfo', [
        input.recipient,
        { commitment: 'confirmed', encoding: 'base64' },
      ]),
      this.rpc.call<{
        value: { blockhash: string; lastValidBlockHeight: number };
      }>('getLatestBlockhash', [{ commitment: 'confirmed' }]),
    ]);
    if (
      destination.value &&
      (destination.value.executable ||
        destination.value.owner !== SystemProgram.programId.toBase58() ||
        destination.value.data[0] !== '')
    )
      throw new BadRequestException(
        'Use a receiving wallet address, rather than a token account or program',
      );
    if (!Number.isSafeInteger(balance.value) || balance.value < 0)
      throw new ServiceUnavailableException('Unable to verify SOL balance');
    const instructions: TransactionInstruction[] = [];
    let rent = 0n;
    if (input.asset === 'SOL') {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: recipient,
          lamports: raw,
        }),
      );
    } else {
      const mint = new PublicKey(mintAddress);
      const target = getAssociatedTokenAddressSync(
        mint,
        recipient,
        false,
        programId,
      );
      const [sources, targetAccount] = await Promise.all([
        this.rpc.call<{ value: TokenAccount[] }>('getTokenAccountsByOwner', [
          input.wallet,
          { mint: mintAddress },
          { commitment: 'confirmed', encoding: 'jsonParsed' },
        ]),
        this.rpc.call<{ value: object | null }>('getAccountInfo', [
          target.toBase58(),
          { commitment: 'confirmed', encoding: 'base64' },
        ]),
      ]);
      if (!Array.isArray(sources.value) || sources.value.length > 64)
        throw new ServiceUnavailableException(
          `Unable to verify ${symbol} balance`,
        );
      if (!targetAccount.value) {
        const minimum = await this.rpc.call<number>(
          'getMinimumBalanceForRentExemption',
          [stock?.accountSize ?? 165, { commitment: 'confirmed' }],
        );
        if (!Number.isSafeInteger(minimum) || minimum < 0)
          throw new ServiceUnavailableException(
            'Unable to estimate account cost',
          );
        rent = BigInt(minimum);
      }
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          sender,
          target,
          recipient,
          mint,
          programId,
        ),
      );
      let remaining = raw;
      const seen = new Set<string>();
      for (const source of sources.value) {
        const info = source.account?.data?.parsed?.info;
        if (
          source.account?.owner !== programId.toBase58() ||
          info?.owner !== input.wallet ||
          info.mint !== mintAddress ||
          info.tokenAmount?.decimals !== decimals ||
          !/^\d{1,20}$/.test(info.tokenAmount.amount) ||
          seen.has(source.pubkey)
        )
          throw new ServiceUnavailableException(
            `Unable to verify ${symbol} accounts`,
          );
        seen.add(source.pubkey);
        if (info.state !== 'initialized') continue;
        const available = BigInt(info.tokenAmount.amount);
        if (available > 18446744073709551615n)
          throw new ServiceUnavailableException(
            'Unable to verify token balance',
          );
        const take = available < remaining ? available : remaining;
        if (take > 0n)
          instructions.push(
            createTransferCheckedInstruction(
              new PublicKey(source.pubkey),
              mint,
              target,
              sender,
              take,
              decimals,
              [],
              programId,
            ),
          );
        remaining -= take;
        if (remaining === 0n) break;
      }
      if (remaining > 0n)
        throw new BadRequestException(`Insufficient available ${symbol}`);
    }
    const message = new TransactionMessage({
      payerKey: sender,
      recentBlockhash: latest.value.blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    let bytes: Uint8Array;
    try {
      bytes = tx.serialize();
    } catch {
      throw new BadRequestException(
        'Tokens are spread across too many accounts for one transfer',
      );
    }
    if (bytes.length > 1232)
      throw new BadRequestException(
        'Tokens are spread across too many accounts for one transfer',
      );
    const transaction = Buffer.from(bytes).toString('base64');
    const fee = await this.rpc.call<{ value: number | null }>(
      'getFeeForMessage',
      [
        Buffer.from(message.serialize()).toString('base64'),
        { commitment: 'confirmed' },
      ],
    );
    if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0)
      throw new BadRequestException(
        'Unable to estimate network fee. Try again.',
      );
    if (
      BigInt(balance.value) <
      (input.asset === 'SOL' ? raw : 0n) + rent + BigInt(fee.value)
    )
      throw new BadRequestException(
        'Insufficient SOL for this transfer and network costs',
      );
    await this.inspection.inspect(transaction, input.wallet);
    const row = await this.approvals.create({
      userId: owner.userId,
      walletId: owner.walletId,
      wallet: input.wallet,
      kind: 'withdrawal',
      referenceId: input.requestId,
      executionId: randomUUID(),
      transaction,
      feeLamports: String(fee.value),
      expiresAt: new Date(Date.now() + 60_000),
      details: {
        asset: input.asset,
        ...(stock
          ? {
              mint: stock.mint,
              symbol: stock.symbol,
              ticker: stock.ticker,
              name: stock.name,
              issuer: stock.issuer,
              assetId: stock.assetId,
              decimals: stock.decimals,
              scaleMultiplier:
                stock.scaleMultiplier === undefined
                  ? undefined
                  : String(stock.scaleMultiplier),
              requestedAmount,
            }
          : {}),
        recipient: input.recipient,
        amount,
        amountAtomic: String(raw),
        rentLamports: String(rent),
        network: 'mainnet',
        blockhashExpiryHeight: latest.value.lastValidBlockHeight,
      },
    });
    return this.view(row);
  }

  private view(row: ApprovalRow) {
    return {
      id: row.id,
      kind: row.kind,
      referenceId: row.referenceId,
      wallet: row.wallet,
      executionId: row.executionId,
      status: row.status,
      details: row.details,
      signature: row.signature ?? undefined,
      feeLamports: row.feeLamports,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
