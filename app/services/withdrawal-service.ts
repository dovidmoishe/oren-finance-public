import { apiRequest } from './api-client';
import { forgetApproval, getPendingServerApprovals, getServerApproval, pendingApprovals, type TradeApproval } from './approval-service';

export interface WithdrawalInput {
  wallet: string;
  recipient: string;
  asset: 'USDC' | 'SOL' | 'STOCK';
  mint?: string;
  amount: string;
  requestId: string;
}

export interface WithdrawalStock {
  mint: string;
  assetId: string;
  ticker: string;
  symbol: string;
  name: string;
  issuer?: string;
  logoUrl?: string;
  decimals: number;
  balance: string;
}

export function getWithdrawalStocks(wallet: string, token: string | null) {
  if (!token) throw new Error('Sign in again to load your stocks.');
  return apiRequest<{ stocks: WithdrawalStock[]; incomplete: boolean }>(`/execution/withdrawals/stocks/${encodeURIComponent(wallet)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
}

/** A lost approve response can leave the server row prepared while auth is still in flight. */
export async function recoverWithdrawal(wallet: string, token: string | null) {
  const ids = [...new Set(pendingApprovals().filter(item => item.wallet === wallet).map(item => item.id))];
  const [remote, local] = await Promise.all([
    getPendingServerApprovals(wallet, token),
    Promise.all(ids.map(id => getServerApproval(id, token))),
  ]);
  for (const row of local) {
    if (row.wallet === wallet && ['confirmed', 'failed'].includes(row.status)) forgetApproval(row.id);
  }
  return [...local, ...remote].find(row => row.wallet === wallet && row.kind === 'withdrawal' && !['confirmed', 'failed'].includes(row.status));
}

export function prepareWithdrawal(input: WithdrawalInput, token: string | null) {
  if (!token) throw new Error('Sign in again before transferring.');
  return apiRequest<TradeApproval>('/execution/withdrawals/prepare', {
    method: 'POST', body: input, headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
}

export function solCost(lamports: string) {
  const raw = BigInt(lamports);
  const digits = raw.toString().padStart(10, '0');
  return `${digits.slice(0, -9)}.${digits.slice(-9)}`.replace(/\.?0+$/, '');
}
