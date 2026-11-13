import { resolveDripTicker, xStockUnderlying } from './drip-symbols';

describe('xStock symbol mapping', () => {
  it('strips the lowercase xStock suffix used in Oren metadata', () => {
    expect(xStockUnderlying('NVDAx')).toBe('NVDA');
    expect(xStockUnderlying('tslax')).toBe('TSLA');
    expect(xStockUnderlying('BRK.Bx')).toBe('BRK.B');
    expect(xStockUnderlying('QQQx')).toBe('QQQ');
  });

  it('leaves real tickers that end in X alone', () => {
    expect(xStockUnderlying('SPX')).toBeNull();
    expect(xStockUnderlying('NVDA')).toBeNull();
    expect(xStockUnderlying('x')).toBeNull();
  });

  it('uses catalog ticker and variant metadata before calling Drip', async () => {
    const lookup = jest.fn((query: string) => {
      if (query === 'nvda-asset' || query.toUpperCase() === 'NVDAX') {
        return Promise.resolve({
          ticker: 'nvda',
          variants: [{ symbol: 'NVDAx' }],
        });
      }
      return Promise.resolve(null);
    });

    await expect(resolveDripTicker('nvda-asset', lookup)).resolves.toEqual({
      ticker: 'NVDA',
      mappedFrom: 'nvda-asset',
    });
    await expect(resolveDripTicker('NVDAX', lookup)).resolves.toEqual({
      ticker: 'NVDA',
      mappedFrom: 'NVDAx',
    });
    await expect(resolveDripTicker('NVDA', lookup)).resolves.toEqual({
      ticker: 'NVDA',
    });
  });

  it('maps an all-caps xStock symbol only when a variant confirms it', async () => {
    const lookup = jest.fn((query: string) =>
      Promise.resolve(
        query === 'NVDA'
          ? { ticker: 'NVDA', variants: [{ symbol: 'NVDAx' }] }
          : null,
      ),
    );

    await expect(resolveDripTicker('NVDAX', lookup)).resolves.toEqual({
      ticker: 'NVDA',
      mappedFrom: 'NVDAX',
    });
  });

  it('maps NVDAx from the xStock spelling when the catalog has no row', async () => {
    const lookup = jest.fn((query: string) =>
      Promise.resolve(
        query === 'NVDA' ? { ticker: 'NVDA', variants: [] } : null,
      ),
    );

    await expect(resolveDripTicker('NVDAx', lookup)).resolves.toEqual({
      ticker: 'NVDA',
      mappedFrom: 'NVDAx',
    });
  });

  it('does not turn SPX into SP without an xStock variant', async () => {
    const lookup = jest.fn((query: string) =>
      Promise.resolve(
        query === 'SP' ? { ticker: 'SP', variants: [{ symbol: 'SP' }] } : null,
      ),
    );

    await expect(resolveDripTicker('SPX', lookup)).resolves.toEqual({
      ticker: 'SPX',
    });
  });

  it('rejects symbols Drip will not accept', async () => {
    await expect(
      resolveDripTicker('not a ticker', () => Promise.resolve(null)),
    ).resolves.toBeNull();
    await expect(
      resolveDripTicker('   ', () => Promise.resolve(null)),
    ).resolves.toBeNull();
  });
});
