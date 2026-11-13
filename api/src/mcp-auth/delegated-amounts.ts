import { microsUsd } from './trade-budget';

/** Preserve the quoted token units exactly in numeric(30,12) intent storage. */
export function rawSellShares(rawInput: string, decimals: number): string {
  if (
    !/^[1-9]\d{0,19}$/.test(rawInput) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  )
    throw new Error('Invalid quoted share amount');
  const raw = BigInt(rawInput);
  if (raw > 18_446_744_073_709_551_615n)
    throw new Error('Invalid quoted share amount');
  const scale = 10n ** BigInt(decimals);
  const whole = String(raw / scale);
  const fraction =
    decimals === 0
      ? ''
      : String(raw % scale)
          .padStart(decimals, '0')
          .replace(/0+$/, '');
  if (whole.length > 18 || fraction.length > 12)
    throw new Error('Quoted share amount exceeds exact intent precision');
  return `${whole}.${fraction.padEnd(12, '0')}`;
}

/** Exact decimal/scientific representation, including catalog number strings. */
function fraction(value: string) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match || value.length > 100) throw new Error('Invalid decimal amount');
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 350)
    throw new Error('Invalid decimal exponent');
  let numerator = BigInt(match[1] + (match[2] ?? ''));
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

/** Value the exact on-chain shares, rounding the dollar charge upward. */
export function rawSellReferenceUsd(
  rawInput: string,
  amountShares: string | null,
  decimals: number,
  price: number | undefined,
) {
  if (
    !/^[1-9]\d{0,19}$/.test(rawInput) ||
    !amountShares ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    !price ||
    !Number.isFinite(price) ||
    price <= 0 ||
    price > 1_000_000_000
  )
    throw new Error('Independent stock valuation is unavailable');
  const raw = BigInt(rawInput);
  const scale = 10n ** BigInt(decimals);
  const shares = fraction(amountShares);
  if (
    raw > 18_446_744_073_709_551_615n ||
    shares.numerator * scale !== raw * shares.denominator
  )
    throw new Error('Share amount differs from raw token input');
  const reference = fraction(String(price));
  const divisor = scale * reference.denominator;
  const micros =
    (raw * reference.numerator * 1_000_000n + divisor - 1n) / divisor;
  if (micros <= 0n)
    throw new Error('Independent stock valuation is unavailable');
  return microsUsd(micros);
}
