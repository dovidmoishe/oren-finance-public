"use client";

import { createContext, useContext } from "react";

/**
 * Local stand-in for `@solana/wallet-adapter-react-ui`'s modal context.
 * Oren never shows the adapter's wallet picker: `PrivySession` interprets
 * `setVisible(true)` as "sign in" (or wallet recovery once signed in).
 */
export interface WalletModalContextState {
  visible: boolean;
  setVisible: (open: boolean) => void;
}

const DEFAULT_CONTEXT: WalletModalContextState = {
  visible: false,
  setVisible() {
    console.error("You have tried to read \"setVisible\" on a WalletModalContext without providing one. Make sure to render a WalletModalContext.Provider as an ancestor of the component that uses WalletModalContext.");
  },
};

export const WalletModalContext = createContext<WalletModalContextState>(DEFAULT_CONTEXT);

export function useWalletModal(): WalletModalContextState {
  return useContext(WalletModalContext);
}
