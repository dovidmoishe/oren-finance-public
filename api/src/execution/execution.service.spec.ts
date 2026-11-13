import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Quote } from '../../types/quote';
import { PriceMovedError } from '../common/errors/provider.errors';
import { BasketCache } from './basket-cache';
import { ExecutionService } from './execution.service';

const wallet = '11111111111111111111111111111111';

function makeQuote(ticker: string, amountUsd: number): Quote {
  const now = new Date();
  return {
    id: `quote-${ticker}`,
    side: 'buy',
    assetId: ticker.toLowerCase(),
    ticker,
    variant: {
      mint: `mint-${ticker}`,
      symbol: `x${ticker}`,
      name: ticker,
      tradable: true,
    },
    inputMint: 'usdc',
    outputMint: `mint-${ticker}`,
    inputSymbol: 'USDC',
    outputSymbol: `x${ticker}`,
    inputAmount: amountUsd,
    outputAmount: amountUsd / 100,
    estimatedPriceUsd: 100,
    amountUsd,
    priceImpactPercent: 0.1,
    slippageBps: 50,
    provider: 'jupiter',
    routePayload: { inAmount: '1' },
    quotedAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
  };
}

describe('ExecutionService basket support', () => {
  const router = {
    quote: jest.fn(),
    prepare: jest.fn(),
  };
  const selector = {
    selectAndQuote: jest.fn(),
    withDecimals: jest.fn((variant: unknown) => Promise.resolve(variant)),
  };
  const quoteCache = {
    set: jest.fn(),
    get: jest.fn(),
    replace: jest.fn(),
    attachExecution: jest.fn(),
    getPendingExecution: jest.fn(),
    delete: jest.fn(),
  };
  const repository = {
    insert: jest.fn(),
    updateStatus: jest.fn(),
    findLatestAwaitingSignature: jest.fn(),
    submitAndEnqueue: jest.fn(),
    findById: jest.fn(),
  };
  const portfolio = {
    getPortfolio: jest.fn(),
  };
  const tokens = {};
  const intelligence = {
    getOpportunities: jest.fn(),
  };
  const trigger = {
    createOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getTriggerOrders: jest.fn(),
  };
  const limitOrderCache = {
    setProposal: jest.fn(),
    getProposal: jest.fn(),
    attachPrepared: jest.fn(),
    getPrepared: jest.fn(),
    deleteProposal: jest.fn(),
    setCancel: jest.fn(),
    getCancel: jest.fn(),
    deleteCancel: jest.fn(),
  };
  const onchain = {
    assertPreparedTransaction: jest.fn(),
  };
  const limitOrderRepository = {
    upsert: jest.fn(),
    findByOrderKey: jest.fn(),
    updateStatus: jest.fn(),
    listByWallet: jest.fn(),
    toRecord: jest.fn(),
  };

  let baskets: BasketCache;
  let service: ExecutionService;

  beforeEach(() => {
    jest.clearAllMocks();
    baskets = new BasketCache();
    service = new ExecutionService(
      router as never,
      trigger as never,
      selector as never,
      quoteCache as never,
      baskets,
      limitOrderCache as never,
      limitOrderRepository as never,
      repository as never,
      portfolio as never,
      tokens as never,
      intelligence as never,
      onchain as never,
    );
  });

  it('rejects a swap signature that is not for the prepared transaction', async () => {
    quoteCache.getPendingExecution.mockReturnValue({
      executionId: 'execution-1',
      wallet,
      transaction: 'not-a-transaction',
    });

    await expect(
      service.confirm({
        executionId: 'execution-1',
        quoteId: 'quote-NVDA',
        wallet,
        signature: 'signature-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.submitAndEnqueue).not.toHaveBeenCalled();
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();
  });

  it('rejects a swap confirm aimed at a different execution', async () => {
    quoteCache.getPendingExecution.mockReturnValue({
      executionId: 'execution-1',
      wallet,
      transaction: 'unsigned',
    });

    await expect(
      service.confirm({
        executionId: 'execution-other',
        quoteId: 'quote-NVDA',
        wallet,
        signature: 'signature-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.submitAndEnqueue).not.toHaveBeenCalled();
  });

  it('creates score-weighted baskets from explicit candidates', async () => {
    const basket = await service.createBasket({
      amountUsd: 100,
      prompt: 'Build me a three stock AI basket',
      candidates: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          opportunityScore: 90,
          signals: { volatility30d: 4 } as never,
        },
        {
          assetId: 'msft',
          ticker: 'MSFT',
          name: 'Microsoft',
          opportunityScore: 60,
          signals: { volatility30d: 2 } as never,
        },
        {
          assetId: 'aapl',
          ticker: 'AAPL',
          name: 'Apple',
          opportunityScore: 50,
          signals: { volatility30d: 1 } as never,
        },
      ],
    });

    expect(basket.allocations.map((a) => a.ticker)).toEqual([
      'NVDA',
      'MSFT',
      'AAPL',
    ]);
    expect(basket.allocations.reduce((sum, a) => sum + a.amountUsd, 0)).toBe(
      100,
    );
    expect(basket.riskLabel).toBe('moderate');
    expect(basket.marketSession?.summary).toEqual(expect.any(String));
    expect(basket.marketSession?.regular).toEqual(expect.any(Boolean));
    expect(baskets.get(basket.id)).toBe(basket);
  });

  it('attaches the US market session to a stock quote and skips unresolved mints', async () => {
    const quoted = makeQuote('NVDA', 25);
    quoted.variant.liquidity = 10_000;
    selector.selectAndQuote.mockResolvedValue({ quote: quoted });
    const stockQuote = await service.getQuote({
      side: 'buy',
      ticker: 'NVDA',
      amountUsd: 25,
    });
    expect(stockQuote.marketSession?.state).toEqual(expect.any(String));
    expect(quoteCache.set).toHaveBeenCalledWith(stockQuote);

    router.quote.mockImplementation((ctx: { assetId: string }) => ({
      ...makeQuote('TOKEN', 1),
      assetId: ctx.assetId,
    }));
    const unresolved = await service.getQuote({
      side: 'buy',
      inputMint: 'usdc-mint',
      outputMint: 'not-a-stock',
      amount: 1,
    });
    expect(unresolved.assetId).toBe('unknown');
    expect(unresolved.marketSession).toBeUndefined();
  });

  it('falls back to opportunities when no candidates are supplied', async () => {
    intelligence.getOpportunities.mockResolvedValue([
      {
        assetId: 'nvda',
        ticker: 'NVDA',
        name: 'NVIDIA',
        opportunityScore: 91,
        signals: { volatility30d: 3 },
      },
      {
        assetId: 'msft',
        ticker: 'MSFT',
        name: 'Microsoft',
        opportunityScore: 80,
        signals: { volatility30d: 2 },
      },
    ]);

    const basket = await service.createBasket({
      amountUsd: 50,
      prompt: 'Build two names',
    });

    expect(intelligence.getOpportunities).toHaveBeenCalledWith({ limit: 5 });
    expect(basket.allocations).toHaveLength(2);
  });

  it('fails basket creation when no opportunities exist', async () => {
    intelligence.getOpportunities.mockResolvedValue([]);

    await expect(
      service.createBasket({ amountUsd: 100, prompt: 'Build a basket' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prepares basket legs sequentially and keeps partial failures', async () => {
    const basket = await service.createBasket({
      amountUsd: 100,
      prompt: 'Build two stock basket',
      candidates: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          opportunityScore: 90,
          signals: { volatility30d: 4 } as never,
        },
        {
          assetId: 'msft',
          ticker: 'MSFT',
          name: 'Microsoft',
          opportunityScore: 60,
          signals: { volatility30d: 2 } as never,
        },
      ],
    });
    const nvdaQuote = makeQuote('NVDA', basket.allocations[0].amountUsd);
    const msftQuote = makeQuote('MSFT', basket.allocations[1].amountUsd);

    selector.selectAndQuote
      .mockResolvedValueOnce({ quote: nvdaQuote })
      .mockResolvedValueOnce({ quote: msftQuote });
    quoteCache.get
      .mockReturnValueOnce({ quote: nvdaQuote })
      .mockReturnValueOnce({ quote: msftQuote });
    router.prepare
      .mockResolvedValueOnce({
        prepared: {
          quoteId: nvdaQuote.id,
          wallet,
          transaction: 'base64-nvda',
          provider: 'jupiter',
          expiresAt: nvdaQuote.expiresAt,
        },
        quote: nvdaQuote,
      })
      .mockRejectedValueOnce(new Error('route vanished'));
    repository.insert.mockResolvedValue({ id: 'exec-1' });

    const result = await service.prepareBasketPurchase({
      basketId: basket.id,
      wallet,
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.progress.legs.map((leg) => leg.status)).toEqual([
      'awaiting_signature',
      'failed',
    ]);
  });

  it('basket legs show the quote that will execute, without its route (H4)', async () => {
    const basket = await service.createBasket({
      amountUsd: 50,
      prompt: 'one stock',
      candidates: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          opportunityScore: 90,
          signals: { volatility30d: 4 } as never,
        },
      ],
    });
    const reviewed = makeQuote('NVDA', basket.allocations[0].amountUsd);
    const executed = {
      ...reviewed,
      provider: 'jupiter-fallback',
      outputAmount: 0.99,
      routePayload: { inAmount: '2' },
    };
    const terms = { minOutRaw: '1', slippageBps: 50, provider: 'jupiter' };
    selector.selectAndQuote.mockResolvedValueOnce({ quote: reviewed });
    quoteCache.get.mockReturnValueOnce({ quote: reviewed, reviewed: terms });
    router.prepare.mockResolvedValueOnce({
      prepared: {
        quoteId: reviewed.id,
        wallet,
        transaction: 'base64-nvda',
        provider: 'jupiter',
        expiresAt: reviewed.expiresAt,
      },
      quote: executed,
    });
    repository.insert.mockResolvedValue({ id: 'exec-1' });

    const result = await service.prepareBasketPurchase({
      basketId: basket.id,
      wallet,
    });

    // The router is held to the terms reviewed when the quote was issued.
    expect(router.prepare).toHaveBeenCalledWith(reviewed, wallet, terms);
    expect(quoteCache.replace).toHaveBeenCalledWith(executed);
    const leg = result.progress.legs[0] as unknown as {
      quote: Record<string, unknown>;
    };
    expect(leg.quote).toMatchObject({
      provider: 'jupiter-fallback',
      outputAmount: 0.99,
    });
    expect(leg.quote).not.toHaveProperty('routePayload');
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'jupiter-fallback' }),
    );
  });

  it('caches the Jupiter alternative from PRICE_MOVED and rethrows', async () => {
    const reviewed = makeQuote('NVDA', 50);
    const alternative = { ...makeQuote('NVDA', 50), id: 'jup-alt' };
    quoteCache.get.mockReturnValueOnce({ quote: reviewed });
    const err = new PriceMovedError(
      undefined,
      undefined,
      { quoteId: reviewed.id } as never,
      alternative,
    );
    router.prepare.mockRejectedValueOnce(err);
    await expect(
      service.prepareWithQuote({ quoteId: reviewed.id, wallet }),
    ).rejects.toBe(err);
    expect(quoteCache.set).toHaveBeenCalledWith(alternative);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('marks a basket leg PRICE_MOVED with its alternative for the user to review', async () => {
    const basket = await service.createBasket({
      amountUsd: 50,
      prompt: 'one stock',
      candidates: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          opportunityScore: 90,
          signals: { volatility30d: 4 } as never,
        },
        {
          assetId: 'msft',
          ticker: 'MSFT',
          name: 'Microsoft',
          opportunityScore: 60,
          signals: { volatility30d: 2 } as never,
        },
      ],
    });
    const nvda = makeQuote('NVDA', basket.allocations[0].amountUsd);
    const msft = makeQuote('MSFT', basket.allocations[1].amountUsd);
    selector.selectAndQuote
      .mockResolvedValueOnce({ quote: nvda })
      .mockResolvedValueOnce({ quote: msft });
    quoteCache.get
      .mockReturnValueOnce({ quote: nvda })
      .mockReturnValueOnce({ quote: msft });
    const details = { quoteId: nvda.id, alternative: { id: 'jup-alt' } };
    router.prepare
      .mockRejectedValueOnce(
        new PriceMovedError(undefined, undefined, details as never),
      )
      .mockResolvedValueOnce({
        prepared: {
          quoteId: msft.id,
          wallet,
          transaction: 'base64-msft',
          provider: 'jupiter',
          expiresAt: msft.expiresAt,
        },
        quote: msft,
      });
    repository.insert.mockResolvedValue({ id: 'exec-2' });

    const result = await service.prepareBasketPurchase({
      basketId: basket.id,
      wallet,
    });
    expect(result.progress.legs[0]).toMatchObject({
      status: 'failed',
      priceMoved: details,
    });
    expect(result.progress.legs[1].status).toBe('awaiting_signature');
  });

  it('stores the route that prepare actually used', async () => {
    const reviewed = makeQuote('NVDA', 50);
    const executed = { ...reviewed, provider: 'titan:Titan-DART' };
    quoteCache.get.mockReturnValueOnce({ quote: reviewed });
    router.prepare.mockResolvedValueOnce({
      prepared: {
        quoteId: reviewed.id,
        wallet,
        transaction: 'base64',
        provider: executed.provider,
        expiresAt: reviewed.expiresAt,
      },
      quote: executed,
    });
    repository.insert.mockResolvedValue({ id: 'exec-titan' });

    await service.prepareWithQuote({ quoteId: reviewed.id, wallet });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'titan:Titan-DART',
        featureSource: 'direct',
      }),
    );
  });

  it('stores Jupiter on a trigger limit order', async () => {
    limitOrderCache.getProposal.mockReturnValueOnce({
      id: 'proposal-1',
      side: 'buy',
      assetId: 'aapl',
      ticker: 'AAPL',
      variant: { mint: 'mint-aapl' },
      inputMint: 'usdc',
      outputMint: 'mint-aapl',
      makingAmount: 25,
      takingAmount: 0.1,
      amountUsd: 25,
      provider: 'jupiter-trigger',
    });
    trigger.createOrder.mockResolvedValueOnce({
      requestId: 'req-1',
      transaction: 'base64-limit',
      order: 'order-key',
    });
    repository.insert.mockResolvedValue({ id: 'exec-limit' });

    const prepared = await service.prepareLimitOrder({
      proposalId: 'proposal-1',
      wallet,
    });

    expect(prepared.provider).toBe('jupiter-trigger');
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'jupiter-trigger',
        featureSource: 'limit_order',
        type: 'limit_buy',
      }),
    );
  });

  describe('limit order confirmation binding', () => {
    const other = 'So11111111111111111111111111111111111111112';
    const proposal = {
      id: 'proposal-1',
      side: 'buy',
      assetId: 'nvda',
      ticker: 'NVDA',
      inputMint: 'usdc',
      outputMint: 'stock',
      makingAmount: 10,
      takingAmount: 0.05,
      limitPriceUsd: 200,
      amountUsd: 10,
      expiredAt: 1_900_000_000,
    };
    const prepared = {
      proposalId: 'proposal-1',
      wallet,
      orderKey: 'order-1',
      transaction: 'prepared-tx',
      executionId: 'execution-1',
    };

    beforeEach(() => {
      limitOrderCache.getProposal.mockReturnValue(proposal);
      limitOrderCache.getPrepared.mockReturnValue(prepared);
      onchain.assertPreparedTransaction.mockResolvedValue({});
      portfolio.getPortfolio.mockResolvedValue({});
    });

    it('rejects a confirm for a wallet other than the one prepared', async () => {
      await expect(
        service.confirmLimitOrder({
          proposalId: 'proposal-1',
          wallet: other,
          signature: 'sig',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(limitOrderRepository.upsert).not.toHaveBeenCalled();
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects a caller-supplied orderKey that differs from Jupiter', async () => {
      await expect(
        service.confirmLimitOrder({
          proposalId: 'proposal-1',
          wallet,
          signature: 'sig',
          orderKey: 'another-order',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(limitOrderRepository.upsert).not.toHaveBeenCalled();
    });

    it('verifies the signature on chain before recording the order', async () => {
      onchain.assertPreparedTransaction.mockRejectedValue(
        new BadRequestException(
          'Transaction does not match the prepared transaction',
        ),
      );
      await expect(
        service.confirmLimitOrder({
          proposalId: 'proposal-1',
          wallet,
          signature: 'forged',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(onchain.assertPreparedTransaction).toHaveBeenCalledWith(
        'forged',
        wallet,
        'prepared-tx',
        'order-1',
      );
      expect(limitOrderRepository.upsert).not.toHaveBeenCalled();
    });

    it('records a verified order under the prepared order key', async () => {
      await service.confirmLimitOrder({
        proposalId: 'proposal-1',
        wallet,
        signature: 'sig',
      });
      expect(limitOrderRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: wallet,
          orderKey: 'order-1',
          openSignature: 'sig',
        }),
      );
    });

    it('rejects a cancel confirm from another wallet', async () => {
      limitOrderCache.getCancel.mockReturnValue({
        orderKey: 'order-1',
        wallet,
        executionId: 'execution-2',
      });
      await expect(
        service.confirmCancelLimitOrder({
          orderKey: 'order-1',
          wallet: other,
          signature: 'sig',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(limitOrderRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('marks an order cancelled only after on-chain verification', async () => {
      limitOrderCache.getCancel.mockReturnValue({
        orderKey: 'order-1',
        wallet,
        transaction: 'prepared-cancel',
        executionId: 'execution-2',
      });
      limitOrderRepository.findByOrderKey.mockResolvedValue({
        walletAddress: wallet,
      });
      limitOrderRepository.updateStatus.mockResolvedValue({ id: 'row' });
      await service.confirmCancelLimitOrder({
        orderKey: 'order-1',
        wallet,
        signature: 'sig',
      });
      expect(onchain.assertPreparedTransaction).toHaveBeenCalledWith(
        'sig',
        wallet,
        'prepared-cancel',
        'order-1',
      );
      expect(limitOrderRepository.updateStatus).toHaveBeenCalledWith(
        'order-1',
        { status: 'cancelled', closeSignature: 'sig' },
        wallet,
      );
    });

    it('does not cancel an order indexed to another wallet', async () => {
      limitOrderCache.getCancel.mockReturnValue({
        orderKey: 'order-1',
        wallet,
        transaction: 'prepared-cancel',
        executionId: 'execution-2',
      });
      limitOrderRepository.findByOrderKey.mockResolvedValue({
        walletAddress: other,
      });
      await expect(
        service.confirmCancelLimitOrder({
          orderKey: 'order-1',
          wallet,
          signature: 'sig',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(onchain.assertPreparedTransaction).not.toHaveBeenCalled();
      expect(limitOrderRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('refuses to prepare a cancel when the order is not indexed', async () => {
      limitOrderRepository.findByOrderKey.mockResolvedValue(null);
      await expect(
        service.prepareCancelLimitOrder({ orderKey: 'order-1', wallet }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trigger.cancelOrder).not.toHaveBeenCalled();
    });

    it('refuses to prepare a cancel for an order indexed under another wallet', async () => {
      limitOrderRepository.findByOrderKey.mockResolvedValue({
        walletAddress: other,
      });
      await expect(
        service.prepareCancelLimitOrder({ orderKey: 'order-1', wallet }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(trigger.cancelOrder).not.toHaveBeenCalled();
    });
  });
});
