import { BadRequestException, ForbiddenException } from '@nestjs/common';

const verify = jest.fn();
const getUser = jest.fn();
jest.mock('@privy-io/node', () => ({
  PrivyClient: jest.fn().mockImplementation(() => ({
    utils: () => ({ auth: () => ({ verifyAccessToken: verify }) }),
    users: () => ({ _get: getUser }),
  })),
}));

import { ResearchController } from './research.controller';
import { ResearchService } from './research.service';
import { assembleCompanyResearch } from './company/assemble';
import { SecFetchError } from './company/sec-client';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';

const apple = {
  id: 'apple',
  ticker: 'AAPL',
  name: 'Apple',
  category: 'equity' as const,
  variants: [{ mint: 'AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8' }],
};

function harness(
  search: Array<{ id: string; ticker: string; name: string }> = [],
) {
  const market = {
    getStock: jest.fn((id: string) =>
      id === 'apple'
        ? Promise.resolve(apple)
        : Promise.reject(new Error(`missing ${id}`)),
    ),
    searchStocks: jest.fn().mockResolvedValue(search),
  };
  const intelligence = {
    getAnalysis: jest.fn().mockResolvedValue({
      analyzedAt: new Date('2026-11-01T00:00:00.000Z'),
      opportunityScore: 61,
      summary: 'Range bound.',
    }),
  };
  const news = { getEquityNews: jest.fn().mockResolvedValue({ items: [] }) };
  const portfolio = {
    getPortfolio: jest.fn((wallet: string) =>
      Promise.resolve({
        positions:
          wallet === 'owned'
            ? [
                {
                  assetId: 'apple',
                  quantity: 2,
                  valueUsd: 200,
                  allocationPercent: 12.5,
                  availableAmount: 2,
                  lockedAmount: 0,
                },
              ]
            : [],
      }),
    ),
  };
  const drip = {
    enabledFor: jest.fn().mockReturnValue(true),
    getOpinions: jest.fn().mockResolvedValue({
      available: true,
      opinions: [],
      summary: {
        calls: 0,
        analysts: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        byAction: {},
      },
      disclaimer: 'Opinions, not facts.',
    }),
  };
  const repository = {
    get: jest.fn().mockResolvedValue(undefined),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };
  const sec = {
    loadCompany: jest.fn().mockResolvedValue({
      facts: { cik: 320193, facts: { 'us-gaap': {} } },
      submissions: {
        cik: '0000320193',
        name: 'Apple Inc.',
        tickers: ['AAPL'],
        fiscalYearEnd: '0926',
        filings: { recent: {} },
      },
      fetchedAt: '2026-11-08T14:00:00.000Z',
      freshness: 'fresh' as const,
    }),
  };
  const company = {
    load: (equity: typeof apple) =>
      assembleCompanyResearch(equity, {
        sec,
        now: new Date('2026-11-08T15:00:00.000Z'),
      }),
  };
  const service = new ResearchService(
    market as never,
    intelligence as never,
    news as never,
    portfolio as never,
    drip as never,
    repository as never,
    company as never,
  );
  return { service, market, portfolio, drip, intelligence, sec };
}

describe('research service company path', () => {
  const caller = { userId: 'did:privy:user', walletAddress: 'owned' };

  it('does not take the first search hit when two assets share a ticker', async () => {
    const { service, market, sec } = harness([
      { id: 'core-scientific', ticker: 'CORZ', name: 'Core Scientific' },
      { id: 'stock-f4ucqqnk', ticker: 'CORZ', name: 'Core Scientific' },
    ]);
    await expect(service.getStock('CORZ', caller)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(market.getStock).toHaveBeenCalledTimes(1);
    expect(market.getStock).toHaveBeenCalledWith('CORZ');
    expect(sec.loadCompany).not.toHaveBeenCalled();
  });

  it('skips an earlier search result whose ticker does not match', async () => {
    const { service, market } = harness([
      { id: 'microsoft', ticker: 'MSFT', name: 'Microsoft' },
      { id: 'apple', ticker: 'AAPL', name: 'Apple' },
    ]);
    const report = await service.getStock('AAPL', caller);
    expect(market.getStock).toHaveBeenNthCalledWith(1, 'AAPL');
    expect(market.getStock).toHaveBeenNthCalledWith(2, 'apple');
    expect(market.getStock).not.toHaveBeenCalledWith('microsoft');
    expect(report.assetId).toBe('apple');
    expect(report.portfolio.data).toMatchObject({ allocationPercent: 12.5 });
  });

  it('uses the authenticated wallet and withholds Drip on the MCP audience', async () => {
    const { service, portfolio, drip } = harness();
    const app = await service.getStock('apple', caller);
    const mcp = await service.getStock(
      'apple',
      { userId: 'did:privy:user', walletAddress: 'owned' },
      { audience: 'mcp' },
    );
    expect(portfolio.getPortfolio).toHaveBeenCalledWith('owned');
    expect(portfolio.getPortfolio).not.toHaveBeenCalledWith('attacker');
    expect(app.company).toEqual(mcp.company);
    expect(mcp.opinions).toEqual({ available: false, reason: 'not_licensed' });
    expect(drip.getOpinions).toHaveBeenCalledTimes(1);
    expect(mcp.analysis.data).toMatchObject({ opportunityScore: 61 });
  });

  it('keeps company facts when technical analysis fails', async () => {
    const { service, intelligence } = harness();
    intelligence.getAnalysis.mockRejectedValueOnce(new Error('analysis down'));
    const report = await service.getStock('apple', caller);
    expect(report.analysis).toMatchObject({
      available: false,
      reason: 'unavailable',
    });
    expect(report.company?.available).toBe(true);
    expect(report.portfolio.available).toBe(true);
  });

  it('keeps the technical read when company facts time out', async () => {
    const { service, sec, intelligence } = harness();
    sec.loadCompany.mockRejectedValue(new SecFetchError('timeout'));
    const report = await service.getStock('apple', caller);
    expect(report.company).toMatchObject({
      available: false,
      reason: 'timeout',
    });
    expect(report.analysis.available).toBe(true);
    expect(intelligence.getAnalysis).toHaveBeenCalledWith('apple');
    expect(report.company?.data?.latestQuarter).toBeUndefined();
  });
});

describe('research route', () => {
  const auth = new PrivyWalletAuth('app', 'secret');

  beforeEach(() => {
    verify.mockResolvedValue({ user_id: 'did:privy:user' });
    getUser.mockResolvedValue({
      linked_accounts: [
        { type: 'wallet', chain_type: 'solana', address: 'owned' },
      ],
    });
  });

  it('uses PrivyWalletAuth and refuses a wallet that is not linked', async () => {
    const { service, portfolio } = harness();
    const controller = new ResearchController(service, auth);
    const report = await controller.getStock('apple', 'owned', 'Bearer token');
    expect(report.portfolio.data).toMatchObject({ allocationPercent: 12.5 });
    expect(portfolio.getPortfolio).toHaveBeenCalledWith('owned');
    await expect(
      controller.getStock('apple', 'attacker', 'Bearer token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(portfolio.getPortfolio).not.toHaveBeenCalledWith('attacker');
    expect(verify).toHaveBeenCalled();
    portfolio.getPortfolio.mockClear();
    await expect(
      controller.getStock('apple', 'owned', undefined),
    ).rejects.toMatchObject({ status: 401 });
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();
  });
});
