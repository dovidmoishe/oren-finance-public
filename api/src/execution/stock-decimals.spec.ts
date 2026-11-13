import { TokensBadRequestError } from '../common/errors/provider.errors';
import { uiAmountToRaw } from './jupiter/jupiter.mapper';
import { StockDecimals } from './stock-decimals';

const variant = {
  mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  symbol: 'NVDAx',
  name: 'NVIDIA xStock',
  tradable: true,
};

function rpcReturning(decimals: unknown) {
  return {
    call: jest.fn().mockResolvedValue({
      value: { data: { parsed: { info: { decimals } } } },
    }),
  };
}

describe('StockDecimals', () => {
  it('uses the mint decimals when the catalog omits them', async () => {
    const rpc = rpcReturning(8);
    const resolved = await new StockDecimals(rpc as never).forVariant(variant);
    expect(resolved.decimals).toBe(8);
    expect(rpc.call).toHaveBeenCalledWith('getAccountInfo', [
      variant.mint,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
  });

  it('sizes the reported NVDAx sell correctly once decimals come from the mint', async () => {
    const resolved = await new StockDecimals(
      rpcReturning(8) as never,
    ).forVariant(variant);
    // 0.00528058 NVDAx is 528,058 raw units, not the 5,281 a 6-decimal guess produced.
    expect(uiAmountToRaw(0.00528058, resolved.decimals!)).toBe('528058');
    expect(uiAmountToRaw(0.00528058, 6)).toBe('5281');
  });

  it('prefers the mint over a wrong catalog value', async () => {
    const resolved = await new StockDecimals(
      rpcReturning(8) as never,
    ).forVariant({ ...variant, decimals: 6 });
    expect(resolved.decimals).toBe(8);
  });

  it('reads each mint once', async () => {
    const rpc = rpcReturning(8);
    const decimals = new StockDecimals(rpc as never);
    await decimals.forVariant(variant);
    await decimals.forVariant(variant);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });

  it('falls back to a catalog value only when the mint cannot be read', async () => {
    const rpc = { call: jest.fn().mockRejectedValue(new Error('rpc down')) };
    const resolved = await new StockDecimals(rpc as never).forVariant({
      ...variant,
      decimals: 8,
    });
    expect(resolved.decimals).toBe(8);
  });

  it('refuses to guess when neither the mint nor the catalog has decimals', async () => {
    const rpc = { call: jest.fn().mockRejectedValue(new Error('rpc down')) };
    await expect(
      new StockDecimals(rpc as never).forVariant(variant),
    ).rejects.toBeInstanceOf(TokensBadRequestError);
    await expect(
      new StockDecimals(rpcReturning('8') as never).forVariant(variant),
    ).rejects.toBeInstanceOf(TokensBadRequestError);
  });
});

describe('StockDecimals scaled-UI multiplier', () => {
  const mint = {
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    symbol: 'NVDAx',
    name: 'NVIDIA xStock',
    tradable: true,
  };
  function rpcWithMultiplier(state: Record<string, unknown>) {
    return {
      call: jest.fn().mockResolvedValue({
        value: {
          data: {
            parsed: {
              info: {
                decimals: 8,
                extensions: [
                  { extension: 'pausableConfig', state: { paused: false } },
                  { extension: 'scaledUiAmountConfig', state },
                ],
              },
            },
          },
        },
      }),
    };
  }

  it('reads the multiplier in effect from the mint extension', async () => {
    const resolved = await new StockDecimals(
      rpcWithMultiplier({
        multiplier: '1.0009180758490996',
        newMultiplier: '1.001701196801074',
        newMultiplierEffectiveTimestamp: 1,
      }) as never,
    ).forVariant(mint);
    expect(resolved.decimals).toBe(8);
    expect(resolved.uiMultiplier).toBe(1.001701196801074);
  });

  it('treats a mint without the extension as unscaled', async () => {
    const resolved = await new StockDecimals(
      rpcReturning(8) as never,
    ).forVariant(mint);
    expect(resolved.uiMultiplier).toBe(1);
  });
});
