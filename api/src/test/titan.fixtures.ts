import type { TitanQuoteResponse } from '../execution/titan/titan.types';

export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const STOCK = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
export const WALLET = '8AdYBZcRixYVacvhGG2PBNruyoWfmagR6aiBUq6qE1nf';
export const TITAN_PROGRAM = 'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT';
export const ALT_USED = '9Re4PV8SstkAFveSuVckncTJakQVS8aT3z8uZvWRY4QA';
export const ALT_UNUSED = 'So11111111111111111111111111111111111111112';

/** Shape from the Titan Portal quickstart, trimmed. Test-only fixture. */
export function titanResponse(
  overrides: Partial<TitanQuoteResponse> = {},
): TitanQuoteResponse {
  return {
    id: 'swap:test:0',
    inputMint: USDC,
    outputMint: STOCK,
    amount: 100_000_000,
    quotes: {
      Titan: {
        inAmount: 100_000_000,
        outAmount: 400_000_000,
        slippageBps: 50,
        steps: [],
        instructions: [
          {
            p: TITAN_PROGRAM,
            a: [{ p: WALLET, s: true, w: true }],
            d: Buffer.from([1, 2, 3]).toString('base64'),
          },
        ],
        addressLookupTables: [ALT_USED],
        contextSlot: 447800832,
        computeUnits: 85743,
        computeUnitsSafe: 171486,
      },
      'Titan-DART': {
        inAmount: 100_000_000,
        outAmount: 401_000_000,
        slippageBps: 50,
        steps: [],
        instructions: [
          {
            p: TITAN_PROGRAM,
            a: [{ p: WALLET, s: true, w: true }],
            d: Buffer.from([9]).toString('base64'),
          },
        ],
        addressLookupTables: [ALT_USED],
        contextSlot: 447800832,
        computeUnits: 1_400_000,
        computeUnitsSafe: 1_400_000,
        referenceId: 'titan_dart',
      },
    },
    metadata: {
      ExpectedWinner: 'Titan-DART',
      inputMintDecimals: 6,
      outputMintDecimals: 8,
      inputPriceUSD: 1,
      outputPriceUSD: 24.9,
    },
    alts: [
      { p: ALT_USED, a: [STOCK, USDC] },
      { p: ALT_UNUSED, a: [USDC] },
    ],
    ...overrides,
  };
}
