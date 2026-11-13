"use client";

import {
  useAuthorizationSignature,
  useLogin,
  usePrivy,
  useSigners,
} from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import {
  type PrivyStandardWallet,
  useCreateWallet,
  useSignMessage,
  useStandardWallets,
  useWallets,
} from "@privy-io/react-auth/solana";
import {
  WalletContext,
  type WalletContextState,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  useAgentStore,
  useExecutionStore,
  usePortfolioStore,
  useSocialStore,
  useVaultStore,
  useWalletStore,
} from "@/store";
import {
  invalidateWalletSession,
  walletSessionIsCurrent,
} from "@/services/wallet-session";
import { useT } from "@/i18n/i18n";
import { getApprovalAuthorizationRequest } from "@/services/approval-service";
import { createPrivySigner } from "@/services/privy-signer";
import {
  resolveEmbeddedSolanaAccount,
  resolveSolanaWallet,
  type WalletSelection,
} from "@/services/wallet-selection";
import { AuthContext } from "./auth-context";
import { setAgentTokenProvider } from "@/services/agent-service";
import { EmailLogin } from "./email-login";
import { WalletModalContext } from "./wallet-modal-context";

const SELECTION_KEY = "oren.active-wallet.v1";
function readSelection(): WalletSelection | undefined {
  if (typeof window === "undefined") return;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(SELECTION_KEY) ?? "null",
    );
    if (
      value &&
      typeof value.userId === "string" &&
      typeof value.address === "string"
    )
      return value;
  } catch {
    /* Storage is optional; ownership still comes from Privy. */
  }
}

function clearWalletData() {
  invalidateWalletSession();
  useWalletStore.getState().reset();
  usePortfolioStore.getState().reset();
  useExecutionStore.getState().resetAll();
  useVaultStore.getState().reset();
  useSocialStore.getState().clearCopy();
  void useAgentStore.getState().initialize();
}

export function PrivySession({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  useEffect(() => {
    setAgentTokenProvider(authenticated ? getAccessToken : undefined);
    return () => setAgentTokenProvider(undefined);
  }, [authenticated, getAccessToken]);
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { addSigners, removeSigners } = useSigners();
  const pathname = usePathname();
  const [depositOpen, setDepositOpen] = useState(false);
  useLogin({
    onComplete: ({ isNewUser, wasAlreadyAuthenticated }) => {
      if (isNewUser && !wasAlreadyAuthenticated) setDepositOpen(true);
    },
  });
  const { wallets } = useWallets();
  const { wallets: standardWallets } = useStandardWallets();
  const embeddedSigner = standardWallets.find(
    (wallet): wallet is PrivyStandardWallet =>
      wallet.name === "Privy" && "isPrivyWallet" in wallet &&
      wallet.isPrivyWallet === true && "solana:signMessage" in wallet.features,
  );
  const { createWallet } = useCreateWallet();
  const { signMessage } = useSignMessage();
  const [selection, setSelection] = useState<WalletSelection | undefined>(
    readSelection,
  );
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const actionLock = useRef(false);
  const setupAttempted = useRef(new Set<string>());
  const setupInFlight = useRef(new Set<string>());
  const [setup, setSetup] = useState<{
    userId: string;
    pending: boolean;
    error?: string;
  }>();
  const currentUser = useRef<string | undefined>(undefined);
  const currentAddress = useRef<string | undefined>(undefined);
  const account = resolveEmbeddedSolanaAccount(user, selection);
  const hasLinkedWallet = account.linked.length > 0;
  const { active: availableWallet } = resolveSolanaWallet(
    wallets,
    user,
    account.active?.address && user
      ? { userId: user.id, address: account.active.address }
      : undefined,
  );
  // Browser signers are optional for legacy message proofs. Server trades use
  // the authenticated embedded account without waiting for signer discovery.
  const active =
    ready && authenticated && !signingOut ? availableWallet : undefined;
  const address =
    ready && authenticated && !signingOut ? account.active?.address : undefined;
  const publicKey = address ? new PublicKey(address) : null;
  const adapterName = address ? "Privy" : undefined;
  const identity = `${authenticated && !signingOut ? (user?.id ?? "") : ""}:${address ?? ""}`;
  useLayoutEffect(() => {
    currentUser.current = authenticated && !signingOut ? user?.id : undefined;
    currentAddress.current = ready && authenticated && !signingOut ? address : undefined;
  }, [ready, authenticated, signingOut, user?.id, address]);

  // Own creation explicitly for the custom email flow, with one automatic attempt per user.
  const setupWallet = useCallback(async () => {
    if (
      !ready ||
      !authenticated ||
      !user ||
      signingOut ||
      hasLinkedWallet ||
      actionLock.current ||
      setupInFlight.current.has(user.id)
    )
      return;
    const userId = user.id;
    setupInFlight.current.add(userId);
    setupAttempted.current.add(userId);
    setSetup({ userId, pending: true });
    try {
      await createWallet();
    } catch {
      if (currentUser.current === userId)
        setSetup({
          userId,
          pending: false,
          error: "We couldn’t prepare your wallet. Please retry.",
        });
    } finally {
      setupInFlight.current.delete(userId);
      if (currentUser.current === userId)
        setSetup((previous) =>
          previous?.userId === userId
            ? { ...previous, pending: false }
            : previous,
        );
    }
  }, [ready, authenticated, user, signingOut, hasLinkedWallet, createWallet]);

  useEffect(() => {
    if (user && !setupAttempted.current.has(user.id)) void setupWallet();
  }, [user, setupWallet]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("deposit") === "1") {
      const frame = window.requestAnimationFrame(() => {
        setDepositOpen(true);
        url.searchParams.delete("deposit");
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + url.search + url.hash,
        );
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [pathname]);

  useLayoutEffect(() => {
    clearWalletData();
    return clearWalletData;
  }, [identity]);

  useLayoutEffect(() => {
    useWalletStore.getState().setWalletState({
      address,
      connected: Boolean(address),
      connecting: !ready,
      adapterName,
    });
  }, [identity, address, ready, adapterName]);

  useEffect(() => {
    const element = dialog.current;
    if (visible && !authenticated) element?.showModal();
    else element?.close();
  }, [visible, authenticated]);

  const open = useCallback(() => {
    setError(undefined);
    setVisible(true);
  }, [setError, setVisible]);
  const signOut = useCallback(async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setSigningOut(true);
    setBusy(true);
    setError(undefined);
    clearWalletData();
    try {
      await logout();
      setVisible(false);
      setDepositOpen(false);
      setupAttempted.current.clear();
    } catch {
      setError("Unable to sign out. Please try again.");
    } finally {
      actionLock.current = false;
      setBusy(false);
      setSigningOut(false);
    }
  }, [logout, setVisible]);

  // Compatibility boundary for existing trade screens; Privy owns the signer.
  const walletContext: WalletContextState = {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey,
    connected: Boolean(address),
    connecting: !ready,
    disconnecting: signingOut,
    select() {},
    async connect() {
      open();
    },
    disconnect: signOut,
    ...createPrivySigner({
      wallet: active,
      getAddress: () => useWalletStore.getState().address,
      async signTransaction() {
        throw new Error(
          "Review and confirm this trade in Oren before submission.",
        );
      },
      signMessage,
    }),
    async sendTransaction() {
      throw new Error(
        "Review and confirm this trade in Oren before submission.",
      );
    },
    signTransaction: undefined,
    signAllTransactions: undefined,
    signIn: undefined,
  };

  return (
    <AuthContext.Provider
      value={{
        configured: true,
        ready,
        authenticated: authenticated && !signingOut,
        address,
        busy: busy || (setup?.userId === user?.id && setup?.pending) || false,
        error:
          error ||
          (setup && setup.userId === user?.id ? setup.error : undefined),
        open,
        signOut,
        getAccessToken,
        async authorizeTrade(id, token) {
          const current = walletSessionIsCurrent();
          if (!ready || !authenticated || !address)
            throw new Error("Sign in before approving a trade.");
          const request = await getApprovalAuthorizationRequest(id, token);
          if (!current())
            throw new Error("Your account changed. Review the trade again.");
          const { signature } = await generateAuthorizationSignature(request);
          if (!current())
            throw new Error("Your account changed. Review the trade again.");
          return signature;
        },
        async addTradeSigner(wallet, signerId, policyId) {
          const userId = currentUser.current;
          if (!ready || !authenticated || !userId || wallet !== address)
            throw new Error(
              "Sign in with the exact embedded wallet to grant trading.",
            );
          await addSigners({
            address: wallet,
            signers: [{ signerId, policyIds: [policyId] }],
          });
          if (currentUser.current !== userId)
            throw new Error(
              "Your account changed. Check the wallet signer state.",
            );
        },
        async signTradePermission(wallet, message) {
          const current = walletSessionIsCurrent();
          const userId = currentUser.current;
          if (!ready || !authenticated || !userId || userId !== user?.id ||
              wallet !== address || wallet !== currentAddress.current ||
              !message.startsWith("Oren chat trading permission\n") || message.length > 4096)
            throw new Error("Review chat trading with your active wallet.");
          const bytes = new TextEncoder().encode(message);
          const signerAccount = embeddedSigner?.accounts.find(
            (account) => account.address === wallet,
          );
          // This SDK gates its account list on legacy (Ethereum) readiness.
          // For an empty list, public account metadata can come from the
          // authenticated, selected embedded account instead. Privy still
          // recovers that exact wallet and requires its owner confirmation.
          const messageAccount = signerAccount ?? (
            embeddedSigner?.accounts.length === 0 && account.active?.address === wallet
              ? { address: wallet, publicKey: new PublicKey(wallet).toBytes(),
                  chains: ["solana:mainnet"] as const,
                  features: ["solana:signMessage"] as const }
              : undefined
          );
          // Linked account identity can restore before the connected-wallet
          // adapter. The Wallet Standard feature retains Privy's internal
          // method receiver, recovery flow and confirmation UI.
          let result: { signature: Uint8Array };
          if (active?.address === wallet) {
            result = await signMessage({ message: bytes, wallet: active });
          } else if (embeddedSigner && messageAccount) {
            const [signed] = await embeddedSigner.features["solana:signMessage"].signMessage({ account: messageAccount, message: bytes });
            if (!signed) throw new Error("Your wallet did not return a permission signature. Review permission again.");
            result = signed;
          } else {
            throw new Error("Your wallet is still restoring. Wait a moment, then review permission again.");
          }
          if (!current() || currentUser.current !== userId || currentAddress.current !== wallet)
            throw new Error("Your wallet changed. Review the permission again.");
          return btoa(String.fromCharCode(...result.signature));
        },
        async removeTradeSigners(wallet) {
          const userId = currentUser.current;
          if (!ready || !authenticated || !userId || wallet !== address)
            throw new Error(
              "Sign in with the exact embedded wallet to revoke trading.",
            );
          await removeSigners({ address: wallet });
          if (currentUser.current !== userId)
            throw new Error(
              "Your account changed. Check the wallet signer state.",
            );
        },
        email: user?.email?.address,
        walletPreparing:
          authenticated &&
          !address &&
          !error &&
          !(setup?.userId === user?.id && setup?.error) &&
          !signingOut,
        depositOpen,
        openDeposit: () => setDepositOpen(true),
        closeDeposit: () => setDepositOpen(false),
        wallets: account.linked.map((wallet) => ({
          address: wallet.address!,
          label: "Privy",
        })),
        selectWallet(next) {
          if (
            user &&
            next !== address &&
            account.linked.some((wallet) => wallet.address === next)
          ) {
            clearWalletData();
            const nextSelection = { userId: user.id, address: next };
            setSelection(nextSelection);
            try {
              window.localStorage.setItem(
                SELECTION_KEY,
                JSON.stringify(nextSelection),
              );
            } catch {
              /* Selection remains usable for this session without storage. */
            }
          }
        },
        createWallet: setupWallet,
      }}
    >
      <WalletContext.Provider value={walletContext}>
        <WalletModalContext.Provider
          value={{
            visible,
            setVisible: (next) => {
              if (next && authenticated) {
                // A trade's legacy connect request is wallet recovery, never account linking.
                if (!address) {
                  setDepositOpen(true);
                  void setupWallet();
                }
                return;
              }
              setVisible(next);
            },
          }}
        >
          {children}
          <dialog
            ref={dialog}
            aria-label={t("auth.title")}
            className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-panel p-6 text-foreground shadow-xl backdrop:bg-black/30"
            onCancel={() => setVisible(false)}
            onClose={() => setVisible(false)}
          >
            <button
              aria-label={t("auth.closeLabel")}
              className="mb-4 ml-auto block text-sm text-muted"
              onClick={() => setVisible(false)}
              type="button"
            >
              {t("auth.close")}
            </button>
            {visible && <EmailLogin onComplete={() => setVisible(false)} />}
          </dialog>
        </WalletModalContext.Provider>
      </WalletContext.Provider>
    </AuthContext.Provider>
  );
}
