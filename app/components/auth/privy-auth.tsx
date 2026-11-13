"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { memo, useContext, useLayoutEffect } from "react";
import { AuthContext, type OrenAuth } from "./auth-context";
import { PrivySession } from "./privy-session";
import { WalletModalContext, type WalletModalContextState } from "./wallet-modal-context";

export interface PublishedSession {
  auth: OrenAuth;
  wallet: WalletContextState;
  modal: WalletModalContextState;
}

/** Copies the session contexts out to `AppProviders`, which owns the app tree. */
function SessionPublisher({ onSession }: { onSession: (session: PublishedSession) => void }) {
  const auth = useContext(AuthContext);
  const wallet = useContext(WalletContext);
  const modal = useContext(WalletModalContext);
  useLayoutEffect(() => { onSession({ auth, wallet, modal }); }, [auth, wallet, modal, onSession]);
  return null;
}

/**
 * Privy and its bundled wallet libraries are heavy, so `AppProviders` loads this
 * module after the app shell renders. It renders beside the app (not around it)
 * so loading it never remounts the page; the session is published upward instead.
 * Memoized so `AppProviders` re-rendering with a new session cannot loop back here.
 */
export const PrivyAuth = memo(function PrivyAuth({ appId, onSession }: { appId: string; onSession: (session: PublishedSession) => void }) {
  return (
    <PrivyProvider appId={appId} config={{
      loginMethods: ["email"],
      appearance: { theme: "light", accentColor: "#171717", walletChainType: "solana-only" },
      // Email sign-in with Privy's embedded Solana wallet only: skip external
      // wallet detection and WalletConnect start-up on every page load.
      externalWallets: { disableAllExternalWallets: true, walletConnect: { enabled: false } },
      embeddedWallets: { solana: { createOnLogin: "off" }, showWalletUIs: true },
    }}>
      <PrivySession>
        <SessionPublisher onSession={onSession} />
      </PrivySession>
    </PrivyProvider>
  );
});
