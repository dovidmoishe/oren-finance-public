import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ExtensionType,
  getAccountLen,
  getAccountTypeOfMintType,
  getExtensionTypes,
  getScaledUiAmountConfig,
  amountToUiAmountForScaledUiAmountMintWithoutSimulation,
  uiAmountToAmountForScaledUiAmountMintWithoutSimulation,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { USDC_MINT } from '../config/constants';
import { decimalAmount } from '../portfolio/funding.types';
import { TokensService } from '../tokens/tokens.service';

export interface WithdrawalTokenAccount {
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

export interface WithdrawalStock {
  mint: string;
  assetId: string;
  ticker: string;
  symbol: string;
  name: string;
  issuer?: string;
  logoUrl?: string;
  decimals: number;
  balance: string;
}

// Support ordinary transfers and adjusted share displays, while excluding
// transfer hooks and token-side fees. Issuer freezes and pauses are simulated.
const supportedExtensions = () =>
  new Set([
    ExtensionType.Uninitialized,
    ExtensionType.MintCloseAuthority,
    ExtensionType.DefaultAccountState,
    ExtensionType.PermanentDelegate,
    ExtensionType.MetadataPointer,
    ExtensionType.TokenMetadata,
    ExtensionType.GroupPointer,
    ExtensionType.TokenGroup,
    ExtensionType.GroupMemberPointer,
    ExtensionType.TokenGroupMember,
    ExtensionType.PausableConfig,
    ExtensionType.PermissionedBurn,
    ExtensionType.ScaledUiAmountConfig,
  ]);

export function shareAmount(raw: bigint, decimals: number) {
  return decimals === 0 ? raw.toString() : decimalAmount(raw, decimals);
}

export function scaledShares(
  raw: bigint,
  decimals: number,
  multiplier: number,
) {
  const displayed = amountToUiAmountForScaledUiAmountMintWithoutSimulation(
    raw,
    decimals,
    multiplier,
  );
  const fixed = Number(displayed).toFixed(decimals);
  if (!Number.isFinite(Number(displayed)) || /e/i.test(fixed))
    throw new BadRequestException('Stock quantity is too large');
  return decimals === 0 ? fixed : fixed.replace(/\.?0+$/, '');
}

export function rawStockShares(
  amount: string,
  decimals: number,
  multiplier: number,
) {
  const raw = uiAmountToAmountForScaledUiAmountMintWithoutSimulation(
    amount,
    decimals,
    multiplier,
  );
  if (raw <= 0n || raw > 18446744073709551615n)
    throw new BadRequestException(
      'Enter a quantity within the stock token precision',
    );
  return raw;
}

@Injectable()
export class WithdrawalStocksService {
  constructor(
    private readonly rpc: AlchemyClient,
    private readonly tokens: TokensService,
  ) {}

  private async metadata(mint: string) {
    const equity = await this.tokens.resolveMint(mint);
    if (!equity) return null;
    const variant =
      equity.variants.find((item) => item.mint === mint) ??
      (await this.tokens.getVariants(equity.id)).find(
        (item) => item.mint === mint,
      );
    if (!variant) return null;
    return {
      assetId: equity.id,
      ticker: equity.ticker,
      symbol: variant.symbol || equity.ticker,
      name: variant.name || equity.name,
      issuer: variant.issuer,
      logoUrl: equity.logo,
    };
  }

  async list(wallet: string) {
    const groups = await Promise.all(
      [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) =>
        this.rpc.call<{ value: WithdrawalTokenAccount[] }>(
          'getTokenAccountsByOwner',
          [
            wallet,
            { programId: program.toBase58() },
            { commitment: 'confirmed', encoding: 'jsonParsed' },
          ],
        ),
      ),
    );
    const held = new Map<string, { raw: bigint; decimals: number }>();
    const seen = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (!Array.isArray(group.value) || group.value.length > 256)
        throw new ServiceUnavailableException('Unable to load stock balances');
      for (const account of group.value) {
        const info = account.account?.data?.parsed?.info;
        if (
          !info ||
          info.owner !== wallet ||
          account.account.owner !==
            [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID][index].toBase58() ||
          seen.has(account.pubkey)
        )
          throw new ServiceUnavailableException(
            'Unable to verify stock balances',
          );
        seen.add(account.pubkey);
        if (info.mint === USDC_MINT || info.state !== 'initialized') continue;
        const { amount, decimals } = info.tokenAmount;
        // An unrelated or empty token account must not hide supported holdings.
        if (!/^\d{1,20}$/.test(amount) || BigInt(amount) === 0n) continue;
        if (
          !Number.isInteger(decimals) ||
          decimals < 0 ||
          decimals > 18 ||
          BigInt(amount) > 18446744073709551615n
        )
          continue;
        const previous = held.get(info.mint);
        if (previous && previous.decimals !== decimals)
          throw new ServiceUnavailableException(
            'Stock precision changed. Try again.',
          );
        held.set(info.mint, {
          raw: (previous?.raw ?? 0n) + BigInt(amount),
          decimals,
        });
      }
    }
    const entries = [...held];
    const stocks: WithdrawalStock[] = [];
    let incomplete = false;
    for (let offset = 0; offset < entries.length; offset += 4) {
      await Promise.all(
        entries.slice(offset, offset + 4).map(async ([mint, balance]) => {
          try {
            const metadata = await this.metadata(mint);
            const token = metadata ? await this.resolve(mint) : null;
            if (token && token.decimals !== balance.decimals)
              throw new ServiceUnavailableException(
                'Stock precision changed. Refresh your holdings.',
              );
            if (metadata && token)
              stocks.push({
                ...metadata,
                mint,
                decimals: balance.decimals,
                balance:
                  token.scaleMultiplier === undefined
                    ? shareAmount(balance.raw, token.decimals)
                    : scaledShares(
                        balance.raw,
                        token.decimals,
                        token.scaleMultiplier,
                      ),
              });
          } catch {
            incomplete = true;
          }
        }),
      );
    }
    stocks.sort(
      (a, b) =>
        a.symbol.localeCompare(b.symbol) || a.mint.localeCompare(b.mint),
    );
    return { stocks, incomplete };
  }

  async resolve(mint: string | undefined) {
    let key: PublicKey;
    try {
      key = new PublicKey(mint ?? '');
      if (key.toBase58() !== mint || mint === USDC_MINT) throw new Error();
    } catch {
      throw new BadRequestException('Choose a stock token from your holdings');
    }
    const metadata = await this.metadata(key.toBase58());
    if (!metadata)
      throw new BadRequestException('This token is not a supported stock');
    const result = await this.rpc.call<{
      value: {
        owner: string;
        data: [string, string];
        lamports: number;
        executable: boolean;
      } | null;
    }>('getAccountInfo', [
      mint,
      { encoding: 'base64', commitment: 'confirmed' },
    ]);
    if (
      !result.value ||
      ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
        result.value.owner,
      )
    )
      throw new BadRequestException('Unsupported stock token program');
    const programId = new PublicKey(result.value.owner);
    const info = unpackMint(
      key,
      {
        ...result.value,
        data: Buffer.from(result.value.data[0], 'base64'),
        owner: programId,
      },
      programId,
    );
    if (!info.isInitialized || info.decimals > 18)
      throw new BadRequestException('Unsupported stock token precision');
    const extensions = getExtensionTypes(info.tlvData);
    const supported = supportedExtensions();
    if (extensions.some((extension) => !supported.has(extension)))
      throw new BadRequestException(
        'This stock token has issuer transfer rules that Oren cannot prepare yet. No transfer was made.',
      );
    const accountSize = programId.equals(TOKEN_PROGRAM_ID)
      ? 165
      : getAccountLen([
          ExtensionType.ImmutableOwner,
          ...extensions
            .map(getAccountTypeOfMintType)
            .filter((type) => type !== ExtensionType.Uninitialized),
        ]);
    const scaled = getScaledUiAmountConfig(info);
    let scaleMultiplier: number | undefined;
    if (scaled) {
      const clock = await this.rpc.call<{
        value: { data: [string, string] } | null;
      }>('getAccountInfo', [
        SYSVAR_CLOCK_PUBKEY.toBase58(),
        { encoding: 'base64', commitment: 'confirmed' },
      ]);
      const clockData = Buffer.from(clock.value?.data[0] ?? '', 'base64');
      if (clockData.length !== 40)
        throw new ServiceUnavailableException(
          'Unable to verify stock adjustment time',
        );
      const timestamp = clockData.readBigInt64LE(32);
      scaleMultiplier =
        timestamp >= scaled.newMultiplierEffectiveTimestamp
          ? scaled.newMultiplier
          : scaled.multiplier;
      if (!Number.isFinite(scaleMultiplier) || scaleMultiplier <= 0)
        throw new BadRequestException(
          'The stock adjustment multiplier is invalid',
        );
    }
    return {
      ...metadata,
      mint: key.toBase58(),
      decimals: info.decimals,
      programId,
      accountSize,
      scaleMultiplier,
    };
  }

  async assertReviewed(details: Record<string, unknown>) {
    if (details.asset !== 'STOCK') return;
    if (
      typeof details.mint !== 'string' ||
      typeof details.decimals !== 'number' ||
      (details.scaleMultiplier !== undefined &&
        typeof details.scaleMultiplier !== 'string')
    )
      throw new BadRequestException('Stock transfer review is incomplete');
    const current = await this.resolve(details.mint);
    if (
      current.decimals !== details.decimals ||
      (current.scaleMultiplier === undefined
        ? undefined
        : String(current.scaleMultiplier)) !== details.scaleMultiplier
    )
      throw new BadRequestException(
        'The stock share adjustment changed. Review a fresh transfer.',
      );
  }
}
