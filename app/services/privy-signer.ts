import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { ConnectedStandardSolanaWallet, useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { walletSessionIsCurrent } from "./wallet-session";

type SignerInput = {
  wallet?: ConnectedStandardSolanaWallet;
  getAddress: () => string | undefined;
  signTransaction: ReturnType<typeof useSignTransaction>["signTransaction"];
  signMessage: ReturnType<typeof useSignMessage>["signMessage"];
};

function serialize(transaction: Transaction | VersionedTransaction) {
  return transaction instanceof VersionedTransaction
    ? transaction.serialize()
    : transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

/** Adapts existing reviewed actions to Privy without changing their wire format. */
export function createPrivySigner({ wallet, getAddress, signTransaction, signMessage }: SignerInput):
  Pick<WalletContextState, "sendTransaction" | "signTransaction" | "signMessage"> {
  function requireCurrentWallet() {
    if (!wallet || getAddress() !== wallet.address) throw new Error("Your wallet changed. Review the action again.");
    return walletSessionIsCurrent();
  }

  return {
    async sendTransaction(transaction, connection, options) {
      const isCurrent = requireCurrentWallet();
      if (!wallet) throw new Error("Sign in before signing.");
      if (options?.signers?.length) {
        if (transaction instanceof VersionedTransaction) transaction.sign(options.signers);
        else transaction.partialSign(...options.signers);
      }
      const { signedTransaction } = await signTransaction({ transaction: serialize(transaction), wallet });
      if (!isCurrent() || getAddress() !== wallet.address) throw new Error("Your wallet changed. Review the action again.");
      return connection.sendRawTransaction(signedTransaction, options);
    },
    signTransaction: wallet ? async (transaction) => {
      const isCurrent = requireCurrentWallet();
      const result = await signTransaction({ transaction: serialize(transaction), wallet });
      if (!isCurrent()) throw new Error("Your wallet changed. Please try again.");
      return (transaction instanceof VersionedTransaction
        ? VersionedTransaction.deserialize(result.signedTransaction)
        : Transaction.from(result.signedTransaction)) as typeof transaction;
    } : undefined,
    signMessage: wallet ? async (message) => {
      const isCurrent = requireCurrentWallet();
      const result = await signMessage({ message, wallet });
      if (!isCurrent()) throw new Error("Your wallet changed. Please try again.");
      return result.signature;
    } : undefined,
  };
}
