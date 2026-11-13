"use client";

import { create } from "zustand";
import { sessionSetter } from "@/services/wallet-session";
import {
  confirmVaultLock,
  confirmVaultUnlock,
  getVaults,
  prepareVaultLock,
  prepareVaultUnlock,
} from "@/services";
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

interface VaultState {
  summary?: VaultSummary;
  positions: VaultPosition[];
  programLive: boolean;
  prepared?: PreparedVaultTransaction;
  confirmation?: ConfirmVaultResponse;
  isLoading: boolean;
  error?: string;
  loadVaults: (wallet: string) => Promise<void>;
  prepareLock: (intent: VaultLockIntent) => Promise<PreparedVaultTransaction | undefined>;
  prepareUnlock: (intent: VaultUnlockIntent) => Promise<PreparedVaultTransaction | undefined>;
  confirmLock: (request: ConfirmVaultLockRequest, token?: string | null) => Promise<ConfirmVaultResponse | undefined>;
  confirmUnlock: (request: ConfirmVaultUnlockRequest, token?: string | null) => Promise<ConfirmVaultResponse | undefined>;
  clearPrepared: () => void;
  reset: () => void;
}

const NOT_LIVE_MESSAGE =
  "Oren Vault program is not live yet. Lock and unlock transactions cannot be signed until the onchain program is deployed.";

export const useVaultStore = create<VaultState>((set, get) => ({
  positions: [],
  programLive: false,
  isLoading: false,
  async loadVaults(wallet) {
    const update = sessionSetter(set);
    update({ isLoading: true, error: undefined });
    try {
      const summary = await getVaults(wallet);
      update({
        summary,
        positions: summary.positions,
        programLive: summary.programLive,
        isLoading: false,
      });
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to load vaults",
        isLoading: false,
      });
    }
  },
  async prepareLock(intent) {
    const update = sessionSetter(set);
    if (!get().programLive) {
      update({ error: NOT_LIVE_MESSAGE });
      return undefined;
    }
    update({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareVaultLock(intent);
      update({ prepared, isLoading: false });
      return prepared;
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to prepare lock",
        isLoading: false,
      });
      return undefined;
    }
  },
  async prepareUnlock(intent) {
    const update = sessionSetter(set);
    if (!get().programLive) {
      update({ error: NOT_LIVE_MESSAGE });
      return undefined;
    }
    update({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareVaultUnlock(intent);
      update({ prepared, isLoading: false });
      return prepared;
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to prepare unlock",
        isLoading: false,
      });
      return undefined;
    }
  },
  async confirmLock(request, token) {
    const update = sessionSetter(set);
    if (!get().programLive) {
      update({ error: NOT_LIVE_MESSAGE });
      return undefined;
    }
    update({ isLoading: true, error: undefined });
    try {
      const confirmation = await confirmVaultLock(request, token);
      update({ confirmation, isLoading: false, prepared: undefined });
      return confirmation;
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to confirm lock",
        isLoading: false,
      });
      return undefined;
    }
  },
  async confirmUnlock(request, token) {
    const update = sessionSetter(set);
    if (!get().programLive) {
      update({ error: NOT_LIVE_MESSAGE });
      return undefined;
    }
    update({ isLoading: true, error: undefined });
    try {
      const confirmation = await confirmVaultUnlock(request, token);
      update({ confirmation, isLoading: false, prepared: undefined });
      return confirmation;
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Unable to confirm unlock",
        isLoading: false,
      });
      return undefined;
    }
  },
  clearPrepared() {
    set({ prepared: undefined, confirmation: undefined, error: undefined });
  },
  reset() {
    set({
      summary: undefined,
      positions: [],
      programLive: false,
      prepared: undefined,
      confirmation: undefined,
      isLoading: false,
      error: undefined,
    });
  },
}));
