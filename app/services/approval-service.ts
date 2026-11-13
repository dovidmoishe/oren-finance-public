import { apiRequest } from './api-client';
import type { QuoteResponse, LimitOrderProposal } from '@/types';
export type ApprovalKind = 'swap' | 'limit' | 'cancel';
export interface TradeApproval {
  id: string;
  kind: ApprovalKind | 'withdrawal';
  referenceId: string;
  wallet: string;
  executionId: string;
  status: 'prepared' | 'signing' | 'signed' | 'submitted' | 'confirmed' | 'failed';
  signature?: string;
  details: { quote?: QuoteResponse; proposal?: LimitOrderProposal; orderKey?: string; ticker?: string; asset?: 'USDC' | 'SOL' | 'STOCK'; mint?: string; symbol?: string; name?: string; issuer?: string; assetId?: string; decimals?: number; requestedAmount?: string; recipient?: string; amount?: string; amountAtomic?: string; rentLamports?: string; network?: 'mainnet' };
  feeLamports: string;
  expiresAt: string;
  message?: string;
}
const headers = (token: string | null) => {
  if (!token) throw new Error('Sign in again before approving a trade.');
  return { Authorization: `Bearer ${token}` };
};
export function prepareServerApproval(input: { kind: ApprovalKind; referenceId: string; wallet: string }, token: string | null) {
  return apiRequest<TradeApproval>('/execution/approvals', { method: 'POST', body: input, headers: headers(token) });
}
const PENDING_KEY = 'oren.pending-approvals.v1';
export function pendingApprovals(): { id: string; wallet: string }[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is { id: string; wallet: string } => typeof item?.id === 'string' && typeof item?.wallet === 'string') : [];
  } catch { return []; }
}
export function forgetApproval(id: string) {
  try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(pendingApprovals().filter(item => item.id !== id))); window.dispatchEvent(new Event('oren-approvals')); } catch { /* Server retains the durable state. */ }
}
export function approveServerTrade(id: string, token: string | null, wallet: string, authorizationSignature?: string) {
  const authHeaders = headers(token);
  try {
    const previous = pendingApprovals().filter(item => item.id !== id);
    window.localStorage.setItem(PENDING_KEY, JSON.stringify([...previous.slice(-49), { id, wallet }]));
    window.dispatchEvent(new Event('oren-approvals'));
  } catch { /* Server remains the source of truth for approval state. */ }
  return apiRequest<TradeApproval>(`/execution/approvals/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { approved: true, authorizationSignature }, headers: authHeaders });
}
export interface ApprovalAuthorizationRequest {
  version: 1; method: 'POST'; url: string; body: Record<string, unknown>;
  headers: { 'privy-app-id': string; 'privy-idempotency-key': string; 'privy-request-expiry': string };
}
export function getApprovalAuthorizationRequest(id: string, token: string | null) {
  return apiRequest<ApprovalAuthorizationRequest>(`/execution/approvals/${encodeURIComponent(id)}/authorization`, { headers: headers(token) });
}
export function getServerApproval(id: string, token: string | null) {
  return apiRequest<TradeApproval>(`/execution/approvals/${encodeURIComponent(id)}`, { headers: headers(token) });
}
export function getPendingServerApprovals(wallet: string, token: string | null) {
  return apiRequest<TradeApproval[]>(`/execution/approvals/pending/${encodeURIComponent(wallet)}`, { headers: headers(token) });
}
