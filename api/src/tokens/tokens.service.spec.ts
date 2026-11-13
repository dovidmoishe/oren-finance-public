import { TokensService } from './tokens.service';

describe('TokensService equity boundaries', () => {
  it('rejects a non-equity asset detail', async () => {
    const client = {
      get: jest.fn().mockResolvedValue({
        assetId: 'zcash',
        ticker: 'ZEC',
        name: 'Zcash',
        category: 'cryptocurrency',
      }),
    };

    const service = new TokensService(client as never);

    await expect(service.getStock('zcash')).rejects.toThrow(
      'Equity asset not found: zcash',
    );
  });

  it('does not turn a resolved crypto mint into a portfolio equity', async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ assetId: 'zcash' })
        .mockResolvedValueOnce({
          assetId: 'zcash',
          ticker: 'ZEC',
          name: 'Zcash',
          category: 'cryptocurrency',
        }),
    };

    const service = new TokensService(client as never);

    await expect(service.resolveMint('zec-mint')).resolves.toBeNull();
  });

  it('keeps a resolved tokenized equity mint', async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ assetId: 'nvidia' })
        .mockResolvedValueOnce({
          assetId: 'nvidia',
          ticker: 'NVDA',
          name: 'NVIDIA',
          category: 'equity',
          variants: [
            {
              mint: 'nvda-mint',
              kind: 'tokenized_equity',
              symbol: 'NVDAx',
            },
          ],
        }),
    };

    const service = new TokensService(client as never);

    await expect(service.resolveMint('nvda-mint')).resolves.toMatchObject({
      id: 'nvidia',
      ticker: 'NVDA',
    });
  });
});
