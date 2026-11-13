import { ResearchService } from './research.service';

it('keeps deterministic research and portfolio context when Drip fails', async () => {
  const market = {
    getStock: jest
      .fn()
      .mockResolvedValue({ id: 'nvda', ticker: 'NVDA', name: 'NVIDIA' }),
  };
  const intelligence = {
    getAnalysis: jest.fn().mockResolvedValue({
      analyzedAt: new Date('2026-11-01'),
      opportunityScore: 60,
      summary: 'Range bound.',
    }),
  };
  const news = { getEquityNews: jest.fn().mockResolvedValue({ items: [] }) };
  const portfolio = {
    getPortfolio: jest.fn().mockResolvedValue({
      positions: [
        {
          assetId: 'nvda',
          quantity: 1,
          valueUsd: 100,
          allocationPercent: 10,
          availableAmount: 1,
          lockedAmount: 0,
        },
      ],
    }),
  };
  const drip = {
    enabledFor: jest.fn().mockReturnValue(true),
    getOpinions: jest
      .fn()
      .mockResolvedValue({ available: false, reason: 'DRIP_TIMEOUT' }),
  };
  const repository = {
    get: jest.fn().mockResolvedValue(undefined),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };
  const company = {
    load: jest
      .fn()
      .mockResolvedValue({ available: false, reason: 'not_mapped' }),
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
  const report = await service.getStock('nvda', {
    userId: 'did:privy:user',
    walletAddress: 'owned',
  });
  expect(report.analysis).toMatchObject({
    available: true,
    data: { opportunityScore: 60 },
  });
  expect(report.portfolio).toMatchObject({
    available: true,
    data: { allocationPercent: 10 },
  });
  expect(report.opinions).toMatchObject({
    available: false,
    reason: 'timeout',
  });
  expect(report.company).toMatchObject({
    available: false,
    reason: 'not_mapped',
  });
  expect(drip.getOpinions).toHaveBeenCalledWith('NVDA', 40, {
    userId: 'did:privy:user',
    walletAddress: 'owned',
  });
});
