import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { handleMcpRequest, type McpResourceDeps } from './mcp-resource';
import {
  mcpConnections,
  mcpDelegatedExecutions,
  mcpTradeIntents,
} from '../database/schema';
import { USDC_MINT } from '../config/constants';
import type { Quote } from '../../types/quote';
import { uiAmountToRaw } from '../execution/jupiter/jupiter.mapper';
import { rawSellReferenceUsd } from './delegated-amounts';
import { SignerGateRejection } from './signer-gate.errors';

jest.mock('@modelcontextprotocol/server', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@modelcontextprotocol/node', () => ({
  NodeStreamableHTTPServerTransport: jest.fn().mockImplementation(() => ({
    handleRequest: jest.fn().mockResolvedValue(undefined),
  })),
}));

async function registeredTools(
  scopes: string[],
  quote?: Quote,
  review?: {
    intent?: {
      id: string;
      mode: string;
      status?: string;
      slippageBps?: number;
      expiresAt?: Date;
    };
    converted?: boolean;
    gateError?: Error;
    gateResult?: { state: string; chainSignature: string };
    execution?: { state: string; chainSignature: string; errorCode: null };
    chainStatus?: { confirmationStatus: string; err: unknown } | null;
    chainUnavailable?: boolean;
    delegationExpiresAt?: Date;
    delegationPolicyId?: string;
  },
) {
  const connection = {
    grantId: 'grant-1',
    clientId: 'client-1',
    userId: 'user-1',
    walletId: 'wallet-1',
    wallet: 'solana-wallet',
    scopes: scopes.join(' '),
    createdAt: new Date(),
  };
  const values = jest.fn().mockReturnValue({
    returning: jest
      .fn()
      .mockResolvedValue([
        { id: 'intent-test', expiresAt: new Date(Date.now() + 300_000) },
      ]),
  });
  const set = jest.fn().mockReturnValue({
    where: () => ({
      returning: jest
        .fn()
        .mockResolvedValue(
          review?.converted ? [{ id: review.intent?.id }] : [],
        ),
    }),
  });
  const getQuote = jest.fn().mockResolvedValue(quote);
  const status = jest.fn().mockResolvedValue(review?.chainStatus);
  if (review?.chainUnavailable)
    status.mockRejectedValue(new Error('private RPC details'));
  const execute = review?.gateError
    ? jest.fn().mockRejectedValue(review.gateError)
    : jest.fn().mockResolvedValue(review?.gateResult);
  const deps = {
    db: {
      update: () => ({ set }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            const limit = jest.fn().mockResolvedValue(
              table === mcpConnections
                ? [connection]
                : table === mcpTradeIntents
                  ? review?.intent
                    ? [review.intent]
                    : []
                  : table === mcpDelegatedExecutions
                    ? review?.execution
                      ? [review.execution]
                      : []
                    : [
                        {
                          id: 'delegation-test',
                          activatedAt: new Date(Date.now() - 60_000),
                          expiresAt:
                            review?.delegationExpiresAt ??
                            new Date(Date.now() + 60_000),
                          status: 'active',
                          policyId:
                            review?.delegationPolicyId ?? 'current-policy',
                          maxSlippageBps: 50,
                          allowSell: true,
                        },
                      ],
            );
            return { limit, orderBy: () => ({ limit }) };
          },
        }),
      }),
      insert: () => ({ values }),
    },
    auth: { verifyMcpWallet: jest.fn().mockResolvedValue(undefined) },
    oauth: {
      resource: 'https://api.oren.finance/mcp',
      appOrigin: 'https://oren.finance',
      issuer: 'https://api.oren.finance/oauth',
      provider: {
        AccessToken: {
          find: jest.fn().mockResolvedValue({
            isValid: true,
            aud: 'https://api.oren.finance/mcp',
            scopes: new Set(scopes),
            accountId: connection.userId,
            clientId: connection.clientId,
            grantId: connection.grantId,
          }),
        },
      },
    },
    gate: { execute },
    tradeRpc: { status },
    delegatedSides: { buy: true, sell: true },
    signerPolicyId: 'current-policy',
    execution: { getQuote },
    market: { getStock: jest.fn().mockResolvedValue({ price: 100 }) },
  } as unknown as McpResourceDeps;
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer opaque-token' },
    body: {},
  } as Request;
  const res = { setHeader: jest.fn() } as unknown as Response;
  await handleMcpRequest(req, res, deps);
  const server = (McpServer as jest.Mock).mock.results.at(-1)?.value as {
    registerTool: jest.Mock;
  };
  const registrations = server.registerTool.mock.calls as [
    string,
    unknown,
    unknown,
  ][];
  return {
    names: registrations.map(([name]) => name),
    values,
    set,
    execute: registrations.find(
      ([name]) => name === 'execute_trade',
    )?.[2] as (input: {
      intentId: string;
      idempotencyKey: string;
    }) => Promise<{ content: { text: string }[]; isError?: boolean }>,
    review: registrations.find(
      ([name]) => name === 'review_trade',
    )?.[2] as (input: {
      intentId: string;
    }) => Promise<{ content: { text: string }[]; isError?: boolean }>,
    prepare: registrations.find(
      ([name]) => name === 'prepare_trade',
    )?.[2] as (input: {
      assetId: string;
      side: 'buy' | 'sell';
      amountShares?: number;
      amountUsd?: number;
      slippageBps: number;
    }) => Promise<{ content: { text: string }[]; isError?: boolean }>,
    getQuote,
    chainLookup: status,
    executeGate: execute,
    tradeStatus: registrations.find(
      ([name]) => name === 'trade_status',
    )?.[2] as (input: {
      intentId: string;
    }) => Promise<{ content: { text: string }[] }>,
  };
}

describe('MCP trade tool exposure', () => {
  beforeEach(() => jest.clearAllMocks());
  const submittedTrade = {
    intent: { id: 'intent-test', mode: 'delegated', status: 'submitted' },
    execution: {
      state: 'broadcast',
      chainSignature: 'trade-signature',
      errorCode: null,
    },
  };

  it.each([
    ['finalized', null, 'confirmed'],
    ['confirmed', { InstructionError: [2, 'Custom'] }, 'failed'],
    ['processed', null, 'broadcast'],
  ])(
    'checks a stored broadcast against Solana status %s',
    async (confirmationStatus, err, expected) => {
      const tools = await registeredTools(
        ['oren.trade.prepare', 'oren.trade.execute'],
        undefined,
        {
          ...submittedTrade,
          chainStatus: { confirmationStatus, err },
        },
      );
      const result = await tools.tradeStatus({ intentId: 'intent-test' });
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        status: expected,
        signature: 'trade-signature',
        ...(expected !== 'broadcast' ? { confirmationStatus } : {}),
        ...(expected === 'failed' ? { reason: 'chain_failure' } : {}),
      });
      expect(tools.chainLookup).toHaveBeenCalledWith(
        'trade-signature',
        expect.any(AbortSignal),
      );
      expect(tools.executeGate).not.toHaveBeenCalled();
    },
  );

  it('keeps an unverified broadcast pending if Solana is unavailable', async () => {
    const tools = await registeredTools(
      ['oren.trade.prepare', 'oren.trade.execute'],
      undefined,
      {
        ...submittedTrade,
        chainUnavailable: true,
        gateResult: submittedTrade.execution,
      },
    );
    const checked = await tools.tradeStatus({ intentId: 'intent-test' });
    const submitted = await tools.execute({
      intentId: 'intent-test',
      idempotencyKey: 'original-execution-key',
    });
    for (const result of [checked, submitted])
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        status: 'broadcast',
        signature: 'trade-signature',
        message: expect.stringContaining('trade_status'),
      });
    expect(JSON.parse(checked.content[0].text).message).toContain(
      'confirmation could not be checked',
    );
  });
  it.each(['delegation_expired', 'delegation_policy_changed'])(
    'returns the renewal link for %s',
    async (browserReason) => {
      const quote = {
        assetId: 'spacex',
        ticker: 'SPCX',
        side: 'buy',
        variant: { mint: 'stock-mint', decimals: 6 },
        inputMint: USDC_MINT,
        outputMint: 'stock-mint',
        inputAmount: 5,
        outputAmount: 0.036,
        provider: 'jupiter',
        slippageBps: 50,
        routePayload: {
          inAmount: '5000000',
          outAmount: '36000',
          otherAmountThreshold: '35820',
          swapMode: 'ExactIn',
        },
      } as Quote;
      const delegationExpiresAt = new Date(Date.now() - 1_000);
      const expired = browserReason === 'delegation_expired';
      const tools = await registeredTools(
        ['oren.trade.prepare', 'oren.trade.execute'],
        quote,
        expired
          ? { delegationExpiresAt }
          : { delegationPolicyId: 'retired-policy' },
      );
      const result = await tools.prepare({
        assetId: 'spacex',
        side: 'buy',
        amountUsd: 5,
        slippageBps: 50,
      });
      expect(tools.getQuote).toHaveBeenCalledWith(
        expect.not.objectContaining({ jupiterOnly: true }),
      );
      expect(tools.values).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'browser', delegationId: null }),
      );
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        mode: 'browser',
        signingGrant: 'inactive',
        browserReason,
        ...(expired
          ? { signingGrantExpiresAt: delegationExpiresAt.toISOString() }
          : {}),
        signingSettingsUrl: 'https://oren.finance/settings/mcp#chat-trading',
      });
    },
  );

  it.each(['insufficient_sol_for_rent', 'insufficient_sol_for_fees'])(
    'reports %s without pending status or browser fallback',
    async (reason) => {
      const tools = await registeredTools(
        ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
        undefined,
        {
          intent: { id: 'intent-test', mode: 'delegated' },
          gateError: new SignerGateRejection(reason),
        },
      );
      const result = await tools.execute({
        intentId: 'intent-test',
        idempotencyKey: 'same-key-123456789',
      });
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        status: 'funding_required',
        reason,
        fundingAsset: 'SOL',
        broadcast: false,
      });
      expect(tools.set).not.toHaveBeenCalled();
    },
  );
  it('reports slippage after the automatic re-quote without a browser link or a permission reason', async () => {
    const tools = await registeredTools(
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
      undefined,
      {
        intent: {
          id: 'intent-test',
          mode: 'delegated',
          status: 'prepared',
          slippageBps: 50,
          expiresAt: new Date(Date.now() + 60_000),
        },
        converted: true,
        gateError: new SignerGateRejection('slippage_exceeded'),
      },
    );
    const result = await tools.execute({
      intentId: 'intent-test',
      idempotencyKey: 'same-key-123456789',
    });
    const body = JSON.parse(result.content[0].text) as {
      message: string;
      reason: string;
    };
    expect(body).toMatchObject({
      status: 'slippage_exceeded',
      reason: 'slippage_exceeded',
      signingGrant: 'active',
      slippageBps: 50,
      broadcast: false,
    });
    expect(body.message).toContain('more than 0.5%');
    expect(body.message).toContain('not a missing signing permission');
    expect(body.reason).not.toBe('inactive_delegation');
    expect(result.isError).toBe(true);
    expect(tools.set).not.toHaveBeenCalled();
  });

  it('sends a genuinely inactive grant to browser review', async () => {
    const tools = await registeredTools(
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
      undefined,
      {
        intent: {
          id: 'intent-test',
          mode: 'delegated',
          status: 'prepared',
          expiresAt: new Date(Date.now() + 60_000),
        },
        converted: true,
        gateError: new SignerGateRejection('inactive_delegation'),
      },
    );
    const result = await tools.execute({
      intentId: 'intent-test',
      idempotencyKey: 'same-key-123456789',
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: 'browser_approval_required',
    });
    expect(tools.set).toHaveBeenCalledWith({
      mode: 'browser',
      delegationId: null,
    });
  });

  it('reports quote movement as a price change, not a missing grant or a forced browser conversion', async () => {
    const tools = await registeredTools(
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
      undefined,
      {
        intent: { id: 'intent-test', mode: 'delegated' },
        gateError: new SignerGateRejection('reviewed_terms_changed'),
      },
    );
    const result = await tools.execute({
      intentId: 'intent-test',
      idempotencyKey: 'same-key-123456789',
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: 'quote_changed',
      reason: 'reviewed_terms_changed',
    });
    expect(tools.set).not.toHaveBeenCalled();
  });

  it('offers the delegated path without browser-only buy aliases to an execute connection', async () => {
    const { names: tools } = await registeredTools([
      'oren.read',
      'oren.trade.prepare',
      'oren.trade.execute',
    ]);
    expect(tools).toEqual(
      expect.arrayContaining([
        'prepare_trade',
        'execute_trade',
        'review_trade',
      ]),
    );
    expect(tools).not.toEqual(
      expect.arrayContaining(['prepare_buy', 'execute_buy']),
    );
  });

  describe('review_trade', () => {
    const scopes = ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'];
    const intentId = '7b2c1c4e-2f0a-4f33-9d6e-1a2b3c4d5e6f';

    it('moves a prepared delegated intent to browser review and returns the link', async () => {
      const { review, set } = await registeredTools(scopes, undefined, {
        intent: { id: intentId, mode: 'delegated' },
        converted: true,
      });
      const result = await review({ intentId });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual({
        intentId,
        status: 'browser_approval_required',
        approvalUrl: `https://oren.finance/app/trades/review/${intentId}`,
      });
      expect(set).toHaveBeenCalledWith({ mode: 'browser', delegationId: null });
    });

    it('refuses when the delegated intent was claimed before it could move', async () => {
      const { review } = await registeredTools(scopes, undefined, {
        intent: { id: intentId, mode: 'delegated' },
        converted: false,
      });
      const result = await review({ intentId });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Intent expired or unavailable.');
    });

    it('returns the link for a browser intent without changing it', async () => {
      const { review, set } = await registeredTools(scopes, undefined, {
        intent: { id: intentId, mode: 'browser' },
      });
      const result = await review({ intentId });
      const body = JSON.parse(result.content[0].text) as {
        approvalUrl: string;
      };
      expect(body.approvalUrl).toBe(
        `https://oren.finance/app/trades/review/${intentId}`,
      );
      expect(set).not.toHaveBeenCalled();
    });

    it('refuses an expired, executed or foreign intent', async () => {
      const { review, set } = await registeredTools(scopes);
      const result = await review({ intentId });
      expect(result.isError).toBe(true);
      expect(set).not.toHaveBeenCalled();
    });
  });

  it('keeps browser-only buy aliases for a prepare connection', async () => {
    const { names: tools } = await registeredTools([
      'oren.read',
      'oren.trade.prepare',
    ]);
    expect(tools).toEqual(
      expect.arrayContaining(['prepare_buy', 'execute_buy', 'prepare_trade']),
    );
    expect(tools).not.toContain('execute_trade');
  });

  it.each([true, false])(
    'persists and reports exact rounded sell shares (execute scope: %s)',
    async (execute) => {
      const requested = 0.123456789;
      const raw = uiAmountToRaw(requested, 8);
      expect(raw).toBe('12345679');
      const quote = {
        id: 'quote-test',
        assetId: 'stock',
        ticker: 'TEST',
        side: 'sell',
        variant: { mint: 'stock-mint', decimals: 8 },
        inputMint: 'stock-mint',
        outputMint: USDC_MINT,
        inputAmount: Number(raw) / 1e8,
        outputAmount: 12.3,
        provider: 'jupiter',
        slippageBps: 50,
        routePayload: {
          inAmount: raw,
          outAmount: '12300000',
          otherAmountThreshold: '12238500',
          swapMode: 'ExactIn',
        },
      } as Quote;
      const scopes = [
        'oren.read',
        'oren.trade.prepare',
        ...(execute ? ['oren.trade.execute'] : []),
      ];
      const tools = await registeredTools(scopes, quote);
      const result = await tools.prepare({
        assetId: 'stock',
        side: 'sell',
        amountShares: requested,
        slippageBps: 50,
      });
      const saved = (
        tools.values.mock.calls as [
          {
            amountShares: string;
            maxInRaw: string;
            referenceValueUsd: string;
            mode: string;
          },
        ][]
      )[0][0];
      expect(saved).toMatchObject({
        amountShares: '0.123456790000',
        maxInRaw: raw,
        referenceValueUsd: '12.345679',
        mode: execute ? 'delegated' : 'browser',
      });
      expect(
        rawSellReferenceUsd(saved.maxInRaw, saved.amountShares, 8, 100),
      ).toBe(saved.referenceValueUsd);
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        amountShares: 0.12345679,
        maxInRaw: raw,
      });
      const calls = tools.getQuote.mock.calls as [{ jupiterOnly?: boolean }][];
      expect(calls[0][0].jupiterOnly).toBe(execute ? true : undefined);
    },
  );

  it('signs a chat trade with Jupiter when Titan would otherwise win', async () => {
    const quote = {
      id: 'quote-jup',
      assetId: 'nvda',
      ticker: 'NVDA',
      side: 'buy',
      variant: { mint: 'stock-mint', decimals: 8 },
      inputMint: USDC_MINT,
      outputMint: 'stock-mint',
      inputAmount: 5,
      outputAmount: 0.02,
      provider: 'jupiter',
      slippageBps: 50,
      routePayload: {
        inAmount: '5000000',
        outAmount: '2000000',
        otherAmountThreshold: '1990000',
        swapMode: 'ExactIn',
      },
    } as Quote;
    const tools = await registeredTools(
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
      quote,
    );
    const result = await tools.prepare({
      assetId: 'nvda',
      side: 'buy',
      amountUsd: 5,
      slippageBps: 50,
    });
    expect(tools.getQuote).toHaveBeenCalledTimes(1);
    expect(tools.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'nvda',
        slippageBps: 50,
        jupiterOnly: true,
      }),
    );
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      mode: 'delegated',
      signingGrant: 'active',
      ticker: 'NVDA',
    });
    expect(
      (
        tools.values.mock.calls as [{ mode: string; delegationId: string }][]
      )[0][0],
    ).toMatchObject({ mode: 'delegated', delegationId: 'delegation-test' });
  });

  it('uses browser review only when Jupiter has no route', async () => {
    const titan = {
      id: 'quote-titan',
      assetId: 'nvda',
      ticker: 'NVDA',
      side: 'buy',
      variant: { mint: 'stock-mint', decimals: 8 },
      inputMint: USDC_MINT,
      outputMint: 'stock-mint',
      inputAmount: 5,
      outputAmount: 0.02,
      provider: 'titan:Titan-DART',
      slippageBps: 50,
      routePayload: {
        inAmount: '5000000',
        outAmount: '2100000',
        otherAmountThreshold: '2089500',
        swapMode: 'ExactIn',
      },
    } as Quote;
    const tools = await registeredTools(
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'],
      titan,
    );
    tools.getQuote
      .mockRejectedValueOnce(new Error('No swap routes for NVDA'))
      .mockResolvedValueOnce(titan);
    const result = await tools.prepare({
      assetId: 'nvda',
      side: 'buy',
      amountUsd: 5,
      slippageBps: 50,
    });
    const calls = tools.getQuote.mock.calls as [{ jupiterOnly?: boolean }][];
    expect(calls[0][0].jupiterOnly).toBe(true);
    expect(calls[1][0].jupiterOnly).toBeUndefined();
    const body = JSON.parse(result.content[0].text) as { message: string };
    expect(body).toMatchObject({
      mode: 'browser',
      signingGrant: 'active',
      browserReason: 'unsupported_venue',
    });
    expect(body.message).toContain('not a missing signing permission');
  });
});
