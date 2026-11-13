export interface FundingSnapshot {
  wallet: string;
  network: 'mainnet';
  commitment: 'confirmed';
  usdcMint: string;
  solLamports: string;
  usdcAtomic: string;
  sol: string;
  usdc: string;
  slot: number;
  updatedAt: string;
}

export type FundingEvent =
  | { type: 'snapshot'; data: FundingSnapshot }
  | {
      type: 'status';
      status: 'connecting' | 'live' | 'reconnecting';
      message?: string;
    }
  | { type: 'error'; message: string };

export function decimalAmount(raw: bigint, decimals: number): string {
  const value = raw.toString().padStart(decimals + 1, '0');
  const fraction = value.slice(-decimals).replace(/0+$/, '');
  return `${value.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}
