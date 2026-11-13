"use client";

import { create } from "zustand";

interface WalletState {
  address?: string;
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  adapterName?: string;
  setWalletState: (state: Partial<Omit<WalletState, "setWalletState" | "reset">>) => void;
  reset: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  connected: false,
  connecting: false,
  disconnecting: false,
  setWalletState(state) {
    set(state);
  },
  reset() {
    set({
      address: undefined,
      connected: false,
      connecting: false,
      disconnecting: false,
      adapterName: undefined,
    });
  },
}));
