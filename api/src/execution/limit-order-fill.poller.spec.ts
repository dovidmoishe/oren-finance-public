import { fillSignatures } from './limit-order-fill.poller';

function order(input: Partial<Record<string, unknown>> = {}) {
  return {
    userPubkey: 'wallet', orderKey: 'order', inputMint: 'in', outputMint: 'out',
    makingAmount: '1', takingAmount: '1', remainingMakingAmount: '0', remainingTakingAmount: '0',
    rawMakingAmount: '1', rawTakingAmount: '1', rawRemainingMakingAmount: '0', rawRemainingTakingAmount: '0',
    slippageBps: '0', expiredAt: null, createdAt: '', updatedAt: '', status: 'Filled',
    openTx: 'open', closeTx: 'close-signature-111111111111111111111111111111', programVersion: 'v1', trades: [],
    ...input,
  } as never;
}

describe('fillSignatures', () => {
  it('deduplicates partial-fill transaction signatures', () => {
    expect(fillSignatures(order({ trades: [
      { signature: 'fill-signature-111111111111111111111111111111' },
      { txId: 'fill-signature-222222222222222222222222222222' },
      { signature: 'fill-signature-111111111111111111111111111111' },
    ] }))).toEqual([
      'fill-signature-111111111111111111111111111111',
      'fill-signature-222222222222222222222222222222',
    ]);
  });

  it('uses closeTx only for a filled order with no trade records', () => {
    expect(fillSignatures(order())).toEqual(['close-signature-111111111111111111111111111111']);
    expect(fillSignatures(order({ status: 'Cancelled' }))).toEqual([]);
  });
});
