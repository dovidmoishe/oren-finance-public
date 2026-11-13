import { mapExecutionRow } from './portfolio.service';
import type { ExecutionRow } from './portfolio.repository';

function row(
  provider: string | null,
  type: ExecutionRow['type'] = 'stock_purchase',
): ExecutionRow {
  return {
    id: 'execution-1',
    walletAddress: 'wallet',
    type,
    assetId: 'aapl',
    ticker: 'AAPL',
    tokenMint: null,
    inputAsset: null,
    outputAsset: null,
    amount: '1',
    amountUsd: '10',
    provider,
    featureSource: type.startsWith('limit') ? 'limit_order' : 'agent',
    transactionSignature: 'sig',
    status: 'confirmed',
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
    submittedAt: new Date('2026-09-15T12:00:00.000Z'),
  };
}

describe('activity route labels', () => {
  it('labels the provider that was stored with the execution', () => {
    expect(mapExecutionRow(row('titan:Titan-DART')).route).toBe('Titan');
    expect(mapExecutionRow(row('jupiter', 'stock_sale')).route).toBe('Jupiter');
    expect(mapExecutionRow(row('jupiter-trigger', 'limit_buy')).route).toBe(
      'Jupiter',
    );
  });

  it('leaves older and non-swap rows unlabeled', () => {
    expect(mapExecutionRow(row(null)).route).toBeUndefined();
    expect(mapExecutionRow(row('oren-vault', 'lock')).route).toBeUndefined();
    expect(mapExecutionRow(row(null)).provider).toBeUndefined();
  });
});
