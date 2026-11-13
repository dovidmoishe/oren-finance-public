import type { Quote } from '../../../types/quote';
import { STOCK, titanResponse, USDC, WALLET } from '../../test/titan.fixtures';
import { TitanService } from './titan.service';
import type { TitanRoutePayload } from './titan.types';

function setup() {
  const client = {
    enabled: true,
    quoteSwap: jest.fn().mockResolvedValue(titanResponse()),
  };
  const builder = {
    build: jest.fn().mockResolvedValue({
      transaction: 'base64-tx',
      blockhash: 'bh',
      computeUnitLimit: 1,
      computeUnitPriceMicroLamports: 1,
      priorityFeeLamports: 1,
      strippedComputeBudget: 0,
      expiresAfterSlot: 447800900,
      sizeBytes: 900,
    }),
  };
  return {
    service: new TitanService(client as never, builder as never),
    client,
    builder,
  };
}

const ctx = {
  side: 'buy' as const,
  assetId: 'tsla',
  ticker: 'TSLA',
  variant: {
    mint: STOCK,
    symbol: 'TSLAx',
    name: 'T',
    decimals: 8,
    tradable: true,
  },
  inputMint: USDC,
  outputMint: STOCK,
  inputSymbol: 'USDC',
  outputSymbol: 'TSLAx',
  inputDecimals: 6,
  outputDecimals: 8,
  amountUi: 100,
  amountUsd: 100,
  wallet: WALLET,
};

describe('TitanService', () => {
  it('quotes in smallest units with Oren default slippage (50 bps)', async () => {
    const { service, client } = setup();
    const quote = await service.getQuoteWithContext(ctx);
    expect(client.quoteSwap).toHaveBeenCalledWith(
      {
        inputMint: USDC,
        outputMint: STOCK,
        amount: '100000000',
        userPublicKey: WALLET,
        slippageBps: 50,
      },
      'background',
    );
    expect(quote.provider).toBe('titan:Titan-DART');
  });

  it('refuses to quote without a valid wallet', async () => {
    const { service, client } = setup();
    await expect(
      service.getQuoteWithContext({ ...ctx, wallet: 'not-a-wallet' }),
    ).rejects.toMatchObject({ titanCode: 'no_wallet' });
    expect(client.quoteSwap).not.toHaveBeenCalled();
  });

  it('re-quotes the identical trade, keeping id, expiry and the Jupiter fallback', async () => {
    const { service, client } = setup();
    const original = await service.getQuoteWithContext(ctx);
    const fallback = { id: 'jup' } as Quote;
    (original.routePayload as TitanRoutePayload).jupiterFallback = fallback;

    const fresh = await service.requote(original, WALLET);

    expect(client.quoteSwap).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: '100000000', slippageBps: 50 }),
      'priority',
    );
    expect(fresh.id).toBe(original.id);
    expect(fresh.expiresAt).toBe(original.expiresAt);
    expect((fresh.routePayload as TitanRoutePayload).jupiterFallback).toBe(
      fallback,
    );
  });

  it('prepares through the tx builder and reports the Titan provider', async () => {
    const { service, builder } = setup();
    const quote = await service.getQuoteWithContext(ctx);
    const prepared = await service.prepareSwap(quote, WALLET);
    expect(builder.build).toHaveBeenCalledWith(quote.routePayload, WALLET);
    expect(prepared).toMatchObject({
      quoteId: quote.id,
      wallet: WALLET,
      transaction: 'base64-tx',
      provider: 'titan:Titan-DART',
      expiresAfterSlot: 447800900,
    });
  });

  it('never lets the approval outlive the route hard expiry (expiresAtMs)', async () => {
    const { service } = setup();
    const quote = await service.getQuoteWithContext(ctx);
    const hard = Date.now() + 10_000;
    (quote.routePayload as TitanRoutePayload).route.expiresAtMs = hard;
    const prepared = await service.prepareSwap(quote, WALLET);
    expect(prepared.expiresAt.getTime()).toBe(hard - 1_000);
    expect(prepared.expiresAt.getTime()).toBeLessThan(
      quote.expiresAt.getTime(),
    );
  });

  it('re-quotes with the originally requested slippage, not the route slippage', async () => {
    const { service, client } = setup();
    const original = await service.getQuoteWithContext({
      ...ctx,
      slippageBps: 80,
    });
    expect(original.slippageBps).toBe(50); // Titan's route used 50
    await service.requote(original, WALLET);
    expect(client.quoteSwap).toHaveBeenLastCalledWith(
      expect.objectContaining({ slippageBps: 80 }),
      'priority',
    );
  });

  it('has no Jupiter-style getQuote entry point', () => {
    const { service } = setup();
    expect((service as unknown as { getQuote?: unknown }).getQuote).toBe(
      undefined,
    );
  });

  it('rejects expired quotes at prepare', async () => {
    const { service } = setup();
    const quote = await service.getQuoteWithContext(ctx);
    quote.expiresAt = new Date(Date.now() - 1);
    await expect(service.prepareSwap(quote, WALLET)).rejects.toThrow(
      'Quote has expired',
    );
  });
});
