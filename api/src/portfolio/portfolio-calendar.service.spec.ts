import { BadRequestException } from '@nestjs/common';
import {
  buildDaySummaries,
  parseCalendarRange,
} from './portfolio-calendar.service';

describe('PortfolioCalendarService helpers', () => {
  it('parses month filters into an inclusive local date range', () => {
    const range = parseCalendarRange({ month: '2026-09', timeZone: 'UTC' });

    expect(range.startDate).toBe('2026-09-01');
    expect(range.endDate).toBe('2026-09-30');
    expect(range.startUtc.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rejects invalid calendar filters', () => {
    expect(() => parseCalendarRange({ month: '09-2026' })).toThrow(
      BadRequestException,
    );
    expect(() => parseCalendarRange({ start: '2026/09/01' })).toThrow(
      BadRequestException,
    );
    expect(() => parseCalendarRange({ timeZone: 'Mars/Base' })).toThrow(
      BadRequestException,
    );
  });

  it('groups snapshots by requested timezone', () => {
    const summaries = buildDaySummaries({
      dates: ['2026-09-15'],
      timeZone: 'Africa/Lagos',
      previousSnapshot: null,
      snapshots: [
        snapshot({
          timestamp: '2026-09-14T23:30:00.000Z',
          total: 100,
          positions: [{ assetId: 'nvda', ticker: 'NVDA', valueUsd: 100 }],
        }),
        snapshot({
          timestamp: '2026-09-15T12:00:00.000Z',
          total: 120,
          positions: [{ assetId: 'nvda', ticker: 'NVDA', valueUsd: 120 }],
        }),
      ],
      executions: [],
      vaultPositions: [],
      agentMessages: [],
    });

    expect(summaries[0].hasData).toBe(true);
    expect(summaries[0].pnlUsd).toBe(20);
    expect(summaries[0].bestContributor?.ticker).toBe('NVDA');
  });

  it('ignores idle cash when computing daily P&L', () => {
    const summaries = buildDaySummaries({
      dates: ['2026-09-15'],
      timeZone: 'UTC',
      previousSnapshot: snapshot({
        timestamp: '2026-09-14T22:00:00.000Z',
        total: 150,
        available: 100,
        positions: [{ assetId: 'aapl', ticker: 'AAPL', valueUsd: 100 }],
      }),
      snapshots: [
        snapshot({
          timestamp: '2026-09-15T20:00:00.000Z',
          total: 170,
          available: 120,
          positions: [{ assetId: 'aapl', ticker: 'AAPL', valueUsd: 120 }],
        }),
      ],
      executions: [],
      vaultPositions: [],
      agentMessages: [],
    });

    expect(summaries[0].openingValueUsd).toBe(100);
    expect(summaries[0].closingValueUsd).toBe(120);
    expect(summaries[0].pnlUsd).toBe(20);
    expect(summaries[0].cumulativeValueUsd).toBe(120);
  });

  it('uses previous snapshot as opening value and joins day events', () => {
    const summaries = buildDaySummaries({
      dates: ['2026-09-15'],
      timeZone: 'UTC',
      previousSnapshot: snapshot({
        timestamp: '2026-09-14T22:00:00.000Z',
        total: 100,
        positions: [{ assetId: 'aapl', ticker: 'AAPL', valueUsd: 60 }],
      }),
      snapshots: [
        snapshot({
          timestamp: '2026-09-15T20:00:00.000Z',
          total: 85,
          positions: [{ assetId: 'aapl', ticker: 'AAPL', valueUsd: 45 }],
        }),
      ],
      executions: [
        {
          id: 'execution-1',
          walletAddress: 'wallet',
          type: 'stock_sale',
          status: 'confirmed',
          ticker: 'AAPL',
          assetId: 'aapl',
          amount: null,
          amountUsd: '10',
          tokenMint: null,
          inputAsset: null,
          outputAsset: null,
          provider: null,
          featureSource: 'direct',
          transactionSignature: null,
          createdAt: new Date('2026-09-15T12:00:00.000Z'),
          submittedAt: null,
        },
      ],
      vaultPositions: [],
      agentMessages: [
        {
          id: 'message-1',
          threadId: 'thread-1',
          role: 'tool',
          content: '{}',
          toolName: 'getPortfolio',
          toolPayload: { wallet: 'wallet' },
          createdAt: new Date('2026-09-15T13:00:00.000Z'),
        },
      ],
    });

    expect(summaries[0].openingValueUsd).toBe(100);
    expect(summaries[0].closingValueUsd).toBe(85);
    expect(summaries[0].realizedActivityUsd).toBe(10);
    expect(summaries[0].unrealizedMovementUsd).toBe(-25);
    expect(summaries[0].worstContributor?.valueChangeUsd).toBe(-15);
    expect(summaries[0].significantEvents.map((event) => event.type)).toEqual([
      'trade',
      'agent',
      'movement',
    ]);
    expect(summaries[0].significantEvents[0].route).toBeUndefined();
  });

  it('labels recorded swap venues and does not invent one', () => {
    const summaries = buildDaySummaries({
      dates: ['2026-09-15'],
      timeZone: 'UTC',
      previousSnapshot: null,
      snapshots: [
        snapshot({
          timestamp: '2026-09-15T20:00:00.000Z',
          total: 10,
          positions: [],
        }),
      ],
      executions: [
        execution({ provider: 'titan:Titan-DART', id: 'titan' }),
        execution({
          provider: 'jupiter-trigger',
          id: 'limit',
          type: 'limit_buy',
        }),
        execution({ provider: null, id: 'legacy' }),
        execution({ provider: 'oren-vault', id: 'lock', type: 'lock' }),
      ],
      vaultPositions: [],
      agentMessages: [],
    });

    expect(summaries[0].significantEvents.map((event) => event.route)).toEqual([
      'Titan',
      'Jupiter',
      undefined,
      undefined,
    ]);
  });
});

function execution(input: {
  id: string;
  provider: string | null;
  type?: 'stock_sale' | 'limit_buy' | 'lock';
}) {
  return {
    id: input.id,
    walletAddress: 'wallet',
    type: input.type ?? 'stock_sale',
    status: 'confirmed' as const,
    ticker: 'AAPL',
    assetId: 'aapl',
    amount: null,
    amountUsd: '10',
    tokenMint: null,
    inputAsset: null,
    outputAsset: null,
    provider: input.provider,
    featureSource: 'direct' as const,
    transactionSignature: null,
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
    submittedAt: null,
  };
}

function snapshot(input: {
  timestamp: string;
  total: number;
  available?: number;
  locked?: number;
  positions?: unknown[];
}) {
  return {
    id: `snapshot-${input.timestamp}`,
    walletAddress: 'wallet',
    timestamp: new Date(input.timestamp),
    totalValueUsd: String(input.total),
    availableValueUsd: String(input.available ?? input.total),
    lockedValueUsd: String(input.locked ?? 0),
    positionsJson: input.positions ?? [],
  };
}
