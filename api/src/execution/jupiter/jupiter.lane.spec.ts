import { JupiterClient } from './jupiter.client';
import { JupiterService } from './jupiter.service';

describe('Jupiter quote rate lanes', () => {
  function setup() {
    const gateway = {
      fetch: jest.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              inputMint: 'in',
              outputMint: 'out',
              inAmount: '1000000',
              outAmount: '2000000',
              otherAmountThreshold: '1990000',
              swapMode: 'ExactIn',
              slippageBps: 50,
              priceImpactPct: '0',
              routePlan: [],
            }),
            { status: 200 },
          ),
        ),
      ),
    };
    const client = new JupiterClient(
      { JUPITER_API_URL: 'https://api.jup.ag/swap/v1' } as never,
      gateway as never,
    );
    return { gateway, service: new JupiterService(client) };
  }

  const ctx = {
    side: 'buy' as const,
    assetId: 'a',
    ticker: 'A',
    variant: { mint: 'out', symbol: 'Ax', name: 'A', tradable: true },
    inputMint: 'in',
    outputMint: 'out',
    inputSymbol: 'USDC',
    outputSymbol: 'Ax',
    inputDecimals: 6,
    outputDecimals: 6,
    amountUi: 1,
    amountUsd: 1,
  };

  it('uses the priority lane for user quotes by default', async () => {
    const { gateway, service } = setup();
    await service.getQuoteWithContext(ctx);
    expect(gateway.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quote?'),
      { method: 'GET' },
      'Jupiter',
      'priority',
    );
  });

  it('uses the background lane for auto-refresh quotes', async () => {
    const { gateway, service } = setup();
    await service.getQuoteWithContext({ ...ctx, lane: 'background' });
    expect(gateway.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quote?'),
      { method: 'GET' },
      'Jupiter',
      'background',
    );
  });
});
