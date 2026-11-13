import { reviewedQuoteFloor } from './reviewed-quote';
describe('preserved reviewed output floor', () => {
  it('accepts a small quote decline by tightening remaining slippage', () => {
    // Original 10 USDC, reviewed minimum 9.95; fresh quote 9.99.
    const q = reviewedQuoteFloor('9990000', '9950000', 50);
    expect(q.slippageBps).toBe(40);
    expect(BigInt(q.otherAmountThreshold)).toBeGreaterThanOrEqual(9950000n);
  });
  it('rejects output below the actual approved minimum', () => {
    expect(() => reviewedQuoteFloor('9949999', '9950000', 50)).toThrow(
      /reviewed terms/,
    );
  });
  it('allows zero remaining slippage at the floor and retains the cap on improved quotes', () => {
    expect(reviewedQuoteFloor('9950000', '9950000', 50)).toEqual({
      slippageBps: 0,
      otherAmountThreshold: '9950000',
    });
    expect(reviewedQuoteFloor('11000000', '9950000', 50).slippageBps).toBe(50);
  });
  it('preserves integer floors at large raw amounts without floating point', () => {
    const minimum = '99999999999999999999';
    const q = reviewedQuoteFloor('100000000000000000000', minimum, 50);
    expect(BigInt(q.otherAmountThreshold)).toBeGreaterThanOrEqual(
      BigInt(minimum),
    );
    expect(q.slippageBps).toBe(0);
  });
});
