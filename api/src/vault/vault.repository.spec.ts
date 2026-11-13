import { rowToVaultPosition, type VaultPositionRow } from './vault.repository';

describe('vault.repository mapping', () => {
  it('maps vault_position rows into API positions', () => {
    const row = {
      lockAddress: 'lockbox',
      owner: 'wallet',
      mint: 'mint',
      assetId: 'nvda',
      ticker: 'NVDA',
      amount: '1.5',
      createdAt: new Date('2026-09-13T10:00:00Z'),
      unlockAt: new Date('2027-01-01T00:00:00Z'),
      transactionSignature: 'sig',
      indexedAt: new Date('2026-09-13T10:01:00Z'),
    } as VaultPositionRow;

    expect(rowToVaultPosition(row)).toEqual({
      lockAddress: 'lockbox',
      owner: 'wallet',
      mint: 'mint',
      assetId: 'nvda',
      ticker: 'NVDA',
      amount: 1.5,
      createdAt: new Date('2026-09-13T10:00:00Z'),
      unlockAt: new Date('2027-01-01T00:00:00Z'),
      transactionSignature: 'sig',
      indexedAt: new Date('2026-09-13T10:01:00Z'),
    });
  });
});
