import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';
import { USDC_MINT } from '../config/constants';
import type { mcpTradeIntents } from '../database/schema';
import type { TokensService } from '../tokens/tokens.service';
import type { ApprovalRpc } from '../execution/approval-rpc.service';
import { inspectDelegatedJupiterTransaction } from './delegated-jupiter-guard';
import { buyNotionalUsd, microsUsd, sellNotionalUsd } from './trade-budget';
import { rawSellReferenceUsd } from './delegated-amounts';

/** API resolves everything itself; no gate-supplied quotes or account metadata. */
export async function inspectApiTradeTransaction(
  transaction: string,
  intent: typeof mcpTradeIntents.$inferSelect,
  deps: { connection: Connection; tokens: TokensService; rpc: ApprovalRpc },
) {
  if (
    !intent.stockMint ||
    !intent.maxInRaw ||
    !intent.minOutRaw ||
    !/^[1-9]\d{0,19}$/.test(intent.maxInRaw) ||
    !/^[1-9]\d{0,19}$/.test(intent.minOutRaw) ||
    !Number.isInteger(intent.slippageBps) ||
    intent.slippageBps < 1 ||
    intent.slippageBps > 50
  )
    throw new Error('Intent has no verifiable raw terms');
  const buyCharge =
    intent.side === 'buy'
      ? buyNotionalUsd(intent.maxInRaw, intent.amountUsd)
      : undefined;
  if (intent.side === 'buy' && !buyCharge)
    throw new Error('Buy amount differs from raw USDC input');
  const stock = await deps.tokens.getStock(intent.assetId);
  if (
    stock.id !== intent.assetId ||
    !stock.variants.some(
      (item) => item.mint === intent.stockMint && item.tradable,
    )
  )
    throw new Error('Stock mint is no longer allowlisted');
  const mint = new PublicKey(intent.stockMint);
  const wallet = new PublicKey(intent.wallet);
  const mintAccount = await deps.connection.getAccountInfo(mint, 'confirmed');
  if (
    !mintAccount ||
    ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
      mintAccount.owner.toBase58(),
    )
  )
    throw new Error('Unsupported stock token program');
  const stockAta = getAssociatedTokenAddressSync(
    mint,
    wallet,
    false,
    mintAccount.owner,
  ).toBase58();
  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    wallet,
  ).toBase58();
  const inputMint = intent.side === 'buy' ? USDC_MINT : intent.stockMint;
  const outputMint = intent.side === 'buy' ? intent.stockMint : USDC_MINT;
  const inspected = await inspectDelegatedJupiterTransaction(
    transaction,
    {
      wallet: intent.wallet,
      inputMint,
      outputMint,
      sourceAta: intent.side === 'buy' ? usdcAta : stockAta,
      destinationAta: intent.side === 'buy' ? stockAta : usdcAta,
      destinationTokenProgram: (intent.side === 'buy'
        ? mintAccount.owner
        : TOKEN_PROGRAM_ID
      ).toBase58(),
      rawInput: intent.maxInRaw,
      maxInputRaw: intent.maxInRaw,
      minimumOutputRaw: intent.minOutRaw,
      maxSlippageBps: intent.slippageBps,
    },
    async (key) => (await deps.connection.getAddressLookupTable(key)).value,
  );
  await deps.rpc.inspect(transaction, intent.wallet, {
    inputMint,
    outputMint,
    maxInRaw: intent.maxInRaw,
    minOutRaw: intent.minOutRaw,
  });
  if (buyCharge) return buyCharge;
  const mintState = unpackMint(mint, mintAccount, mintAccount.owner);
  if (!mintState.isInitialized) throw new Error('Stock mint is uninitialized');
  return sellNotionalUsd(
    rawSellReferenceUsd(
      intent.maxInRaw,
      intent.amountShares,
      mintState.decimals,
      stock.price,
    ),
    microsUsd(BigInt(inspected.quotedOutputRaw)),
  );
}
