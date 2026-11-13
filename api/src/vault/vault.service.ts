import { assertFinancialExecutionEnabled } from '../config/deployment';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TokenizedEquity } from '../../types/equity';
import type { TokenAccount } from '../../types/providers/alchemy-provider';
import type {
  ConfirmLockRequest,
  ConfirmUnlockRequest,
  ConfirmVaultResponse,
  LockIntent,
  PreparedVaultTransaction,
  UnlockIntent,
  VaultPosition,
  VaultSummary,
} from '../../types/vault';
import { AlchemyService } from '../alchemy/alchemy.service';
import { InvalidWalletAddressError } from '../common/errors/provider.errors';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TokensService } from '../tokens/tokens.service';
import {
  decimalToRaw,
  VaultTransactionBuilder,
} from './vault-transaction.builder';
import {
  rowToVaultPosition,
  VaultRepository,
  type VaultPositionRow,
} from './vault.repository';
import { PublicKey } from '@solana/web3.js';
import {
  assertSignatureFormat,
  decodeConfirmedTransaction,
} from '../execution/onchain-transaction';
import {
  assertLockCustody,
  lockedUiAmount,
  verifyVaultInstruction,
} from './vault-confirmation';

export const VAULT_PROGRAM_NOT_LIVE = 'VAULT_PROGRAM_NOT_LIVE';

const VAULT_NOT_LIVE_MESSAGE =
  'Oren Vault program is not live yet. Lock and unlock transactions cannot be prepared or confirmed until the onchain program is deployed.';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly repository: VaultRepository,
    private readonly builder: VaultTransactionBuilder,
    private readonly alchemy: AlchemyService,
    private readonly portfolio: PortfolioService,
    private readonly tokens: TokensService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async listVaults(walletAddress: string): Promise<VaultSummary> {
    const wallet = assertPublicKey(walletAddress, 'wallet');
    const rows = await this.repository.listByOwner(wallet);
    const positions = await this.enrich(rows);
    return {
      walletAddress: wallet,
      totalLockedValueUsd: positions.reduce(
        (sum, position) => sum + (position.valueUsd ?? 0),
        0,
      ),
      positions,
      programLive: this.env.VAULT_PROGRAM_LIVE,
    };
  }

  async prepareLock(input: LockIntent): Promise<PreparedVaultTransaction> {
    assertFinancialExecutionEnabled();
    this.assertProgramLive();
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const unlockAt = toDate(input.unlockAt);
    if (unlockAt.getTime() <= Date.now()) {
      throw new BadRequestException('unlockAt must be in the future');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('amount must be > 0');
    }

    const selected = await this.selectLockVariant(wallet, input);
    const tokenProgramId =
      selected.account.programId ??
      (await this.builder.getTokenProgramId(selected.mint));
    const amountRaw = decimalToRaw(input.amount, selected.account.decimals);

    const built = await this.builder.buildLock({
      wallet,
      mint: selected.mint,
      userTokenAccount: selected.account.address,
      tokenProgramId,
      amountRaw,
      unlockAt,
    });

    return {
      wallet,
      transaction: built.transaction,
      lockAddress: built.lockAddress,
      tokenVaultAddress: built.tokenVaultAddress,
      unlockAt,
      amount: input.amount,
      mint: selected.mint,
      assetId: selected.assetId,
      ticker: selected.ticker,
    };
  }

  async confirmLock(input: ConfirmLockRequest): Promise<ConfirmVaultResponse> {
    assertFinancialExecutionEnabled();
    this.assertProgramLive();
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const lockAddress = assertPublicKey(input.lockAddress, 'lockAddress');
    const signature = assertNonEmpty(input.signature, 'signature');
    // Index only what the chain shows this wallet locked, not client claims.
    const confirmed = await this.confirmedTransaction(signature);
    const lock = verifyVaultInstruction(confirmed, {
      wallet,
      programId: this.env.VAULT_PROGRAM_ID,
      instruction: 'lock_tokens',
      lockAddress,
    });
    let vaultAccount: Buffer | null;
    try {
      vaultAccount = await this.alchemy.getAccountData(lock.tokenVault);
    } catch {
      throw new ServiceUnavailableException(
        'Locked token vault could not be read. Retry after it is visible.',
      );
    }
    assertLockCustody(lock, vaultAccount);
    const amount = lockedUiAmount(confirmed, lock.mint, lock.amountRaw!);
    const unlockAt = new Date(Number(lock.unlockTime!) * 1000);
    const equity =
      input.mint === lock.mint
        ? { assetId: input.assetId, ticker: input.ticker }
        : { assetId: undefined, ticker: undefined };

    await this.repository.upsertLock({
      ...input,
      ...equity,
      wallet,
      lockAddress,
      mint: lock.mint,
      amount,
      signature,
      unlockAt,
    });
    await this.repository.recordExecution({
      walletAddress: wallet,
      type: 'lock',
      ...equity,
      tokenMint: lock.mint,
      amount,
      transactionSignature: signature,
    });

    return this.confirmResponse(wallet, lockAddress, signature);
  }

  async prepareUnlock(input: UnlockIntent): Promise<PreparedVaultTransaction> {
    assertFinancialExecutionEnabled();
    this.assertProgramLive();
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const lockAddress = assertPublicKey(input.lockAddress, 'lockAddress');
    const row = await this.getIndexedPosition(wallet, lockAddress);
    if (row.unlockAt.getTime() > Date.now()) {
      throw new BadRequestException('Vault position is still locked');
    }

    const tokenProgramId = await this.builder.getTokenProgramId(row.mint);
    const built = await this.builder.buildUnlock({
      wallet,
      mint: row.mint,
      tokenProgramId,
    });
    if (built.lockAddress !== row.lockAddress) {
      throw new BadRequestException('Indexed lock does not match vault PDA');
    }

    return {
      wallet,
      transaction: built.transaction,
      lockAddress: built.lockAddress,
      tokenVaultAddress: built.tokenVaultAddress,
      unlockAt: row.unlockAt,
      amount: Number(row.amount),
      mint: row.mint,
      assetId: row.assetId ?? undefined,
      ticker: row.ticker ?? undefined,
    };
  }

  async confirmUnlock(
    input: ConfirmUnlockRequest,
  ): Promise<ConfirmVaultResponse> {
    assertFinancialExecutionEnabled();
    this.assertProgramLive();
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const lockAddress = assertPublicKey(input.lockAddress, 'lockAddress');
    const signature = assertNonEmpty(input.signature, 'signature');
    const row = await this.getIndexedPosition(wallet, lockAddress);
    // Only this wallet's own withdraw from this lock may clear the index.
    const unlock = verifyVaultInstruction(
      await this.confirmedTransaction(signature),
      {
        wallet,
        programId: this.env.VAULT_PROGRAM_ID,
        instruction: 'withdraw_tokens',
        lockAddress,
      },
    );
    if (unlock.mint !== row.mint)
      throw new BadRequestException(
        'Unlock transaction is for a different mint',
      );
    await this.repository.removeLock(wallet, lockAddress);
    await this.repository.recordExecution({
      walletAddress: wallet,
      type: 'unlock',
      assetId: row.assetId ?? undefined,
      ticker: row.ticker ?? undefined,
      tokenMint: row.mint,
      amount: Number(row.amount),
      transactionSignature: signature,
    });

    return this.confirmResponse(wallet, lockAddress, signature);
  }


  private assertProgramLive(): void {
    if (this.env.VAULT_PROGRAM_LIVE) {
      return;
    }
    throw new ServiceUnavailableException({
      statusCode: 503,
      message: VAULT_NOT_LIVE_MESSAGE,
      error: VAULT_PROGRAM_NOT_LIVE,
    });
  }

  private async selectLockVariant(wallet: string, input: LockIntent): Promise<{
    mint: string;
    account: TokenAccount;
    assetId?: string;
    ticker?: string;
  }> {
    const [portfolio, accounts] = await Promise.all([
      this.portfolio.getPortfolio(wallet),
      this.alchemy.getTokenAccounts(wallet),
    ]);
    const requested = (input.assetId ?? input.asset).trim().toLowerCase();
    const requestedMint = input.mint?.trim();
    const position = portfolio.positions.find((p) => {
      if (requestedMint && p.variants?.some((v) => v.variant.mint === requestedMint)) {
        return true;
      }
      return (
        p.assetId.toLowerCase() === requested ||
        p.ticker.toLowerCase() === requested ||
        p.name.toLowerCase() === requested
      );
    });

    if (!position) {
      throw new BadRequestException('No matching portfolio position to lock');
    }

    const variant = position.variants?.find((entry) => {
      if (requestedMint && entry.variant.mint !== requestedMint) return false;
      return entry.availableAmount >= input.amount;
    });
    if (!variant) {
      throw new BadRequestException('Insufficient available amount to lock');
    }

    const account = accounts.find(
      (acct) =>
        acct.mint === variant.variant.mint &&
        acct.uiAmount >= input.amount,
    );
    if (!account) {
      throw new BadRequestException('No wallet token account found for lock');
    }

    return {
      mint: variant.variant.mint,
      account,
      assetId: position.assetId,
      ticker: position.ticker,
    };
  }

  private async enrich(rows: VaultPositionRow[]): Promise<VaultPosition[]> {
    if (rows.length === 0) {
      return [];
    }
    const mints = [...new Set(rows.map((row) => row.mint))];
    const snapshots = await this.tokens.getMarketSnapshots(mints).catch((err) => {
      this.logger.warn(
        `vault market snapshots failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    });
    const priceByMint = new Map<string, number | undefined>();
    for (const snapshot of snapshots) {
      if (snapshot.mint) priceByMint.set(snapshot.mint, snapshot.price);
    }

    const positions = await Promise.all(
      rows.map(async (row) => {
        const position = rowToVaultPosition(row);
        let variant: TokenizedEquity | undefined;
        let name: string | undefined;
        try {
          const equity = await this.tokens.resolveMint(row.mint);
          variant = equity?.variants.find((v) => v.mint === row.mint);
          name = equity?.name;
          position.assetId = position.assetId ?? equity?.id;
          position.ticker = position.ticker ?? equity?.ticker;
        } catch {
          // enrichment is optional; indexed lock remains useful
        }
        const price = priceByMint.get(row.mint);
        return {
          ...position,
          variant,
          name,
          valueUsd:
            typeof price === 'number' ? Number(row.amount) * price : undefined,
          daysRemaining: Math.max(
            0,
            Math.ceil((row.unlockAt.getTime() - Date.now()) / 86_400_000),
          ),
        };
      }),
    );

    return positions.sort((a, b) => a.unlockAt.getTime() - b.unlockAt.getTime());
  }

  private async getIndexedPosition(
    wallet: string,
    lockAddress: string,
  ): Promise<VaultPositionRow> {
    const row = await this.repository.findByOwnerAndLockAddress(
      wallet,
      lockAddress,
    );
    if (!row) throw new BadRequestException('Vault position not found');
    return row;
  }

  private async confirmedTransaction(signature: string) {
    const value = assertSignatureFormat(signature);
    return decodeConfirmedTransaction(
      await this.alchemy.getConfirmedRawTransaction(value),
      value,
    );
  }

  private async confirmResponse(
    wallet: string,
    lockAddress: string,
    signature: string,
  ): Promise<ConfirmVaultResponse> {
    let portfolioRefreshed = false;
    try {
      await this.portfolio.getPortfolio(wallet);
      portfolioRefreshed = true;
    } catch (err) {
      this.logger.warn(
        `Post-vault portfolio refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      wallet,
      lockAddress,
      signature,
      status: 'confirmed',
      portfolioRefreshed,
    };
  }
}

function assertPublicKey(value: string, field: string): string {
  const trimmed = assertNonEmpty(value, field);
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    throw new InvalidWalletAddressError(`${field} must be a valid public key`);
  }
}

function assertNonEmpty(value: string, field: string): string {
  if (!value?.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date');
  }
  return date;
}
