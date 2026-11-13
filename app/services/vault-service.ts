import { apiRequest } from "./api-client";
import type {
  ConfirmVaultLockRequest,
  ConfirmVaultResponse,
  ConfirmVaultUnlockRequest,
  PreparedVaultTransaction,
  VaultLockIntent,
  VaultPosition,
  VaultSummary,
  VaultUnlockIntent,
} from "@/types";

interface ApiVaultPosition {
  lockAddress: string;
  owner: string;
  mint: string;
  assetId?: string;
  ticker?: string;
  name?: string;
  amount: number;
  createdAt: string;
  unlockAt: string;
  transactionSignature?: string;
  indexedAt?: string;
  valueUsd?: number;
  daysRemaining?: number;
}

interface ApiVaultSummary {
  walletAddress: string;
  totalLockedValueUsd: number;
  positions: ApiVaultPosition[];
  programLive: boolean;
}

function mapPosition(position: ApiVaultPosition): VaultPosition {
  const unlockAt = typeof position.unlockAt === "string" ? position.unlockAt : new Date(position.unlockAt).toISOString();
  const createdAt =
    typeof position.createdAt === "string" ? position.createdAt : new Date(position.createdAt).toISOString();
  const daysRemaining =
    position.daysRemaining ??
    Math.max(0, Math.ceil((new Date(unlockAt).getTime() - Date.now()) / 86_400_000));

  return {
    lockAddress: position.lockAddress,
    owner: position.owner,
    assetId: position.assetId,
    ticker: position.ticker,
    name: position.name,
    mint: position.mint,
    quantity: position.amount,
    valueUsd: position.valueUsd,
    createdAt,
    unlockAt,
    transactionSignature: position.transactionSignature,
    daysRemaining,
  };
}

function mapSummary(summary: ApiVaultSummary): VaultSummary {
  return {
    walletAddress: summary.walletAddress,
    totalLockedValueUsd: summary.totalLockedValueUsd,
    positions: (summary.positions ?? []).map(mapPosition),
    programLive: Boolean(summary.programLive),
  };
}

export async function getVaults(wallet: string): Promise<VaultSummary> {
  const summary = await apiRequest<ApiVaultSummary>(`/vaults/${wallet}`);
  return mapSummary(summary);
}

export function prepareVaultLock(intent: VaultLockIntent) {
  return apiRequest<PreparedVaultTransaction>("/vaults/prepare-lock", {
    method: "POST",
    body: intent,
  });
}

export function prepareVaultUnlock(intent: VaultUnlockIntent) {
  return apiRequest<PreparedVaultTransaction>("/vaults/prepare-unlock", {
    method: "POST",
    body: intent,
  });
}

export function confirmVaultLock(request: ConfirmVaultLockRequest, token?: string | null) {
  return apiRequest<ConfirmVaultResponse>("/vaults/confirm-lock", {
    method: "POST",
    body: request,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export function confirmVaultUnlock(request: ConfirmVaultUnlockRequest, token?: string | null) {
  return apiRequest<ConfirmVaultResponse>("/vaults/confirm-unlock", {
    method: "POST",
    body: request,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
