export type WalletSelection = { userId: string; address: string };
type WalletOwner = { id: string; linkedAccounts: { type: string; chainType?: string; address?: string; walletClientType?: string }[] };

/** Account identity does not require a browser signer to finish discovery. */
export function resolveEmbeddedSolanaAccount(user: WalletOwner | null, selection?: WalletSelection) {
  const linked = user?.linkedAccounts.filter(account => account.type === 'wallet' && account.chainType === 'solana' && account.walletClientType === 'privy' && account.address) ?? [];
  const selected = selection?.userId === user?.id ? linked.find(account => account.address === selection?.address) : undefined;
  return { linked, active: selected ?? linked[0] };
}

export function resolveSolanaWallet<T extends { address: string }>(
  wallets: T[], user: WalletOwner | null, selection?: WalletSelection,
) {
  const owns = (address: string) => user?.linkedAccounts.some((account) =>
    account.type === "wallet" && account.chainType === "solana" && account.address === address);
  const linked = wallets.filter((wallet) => owns(wallet.address));
  const selected = selection?.userId === user?.id && selection && owns(selection.address)
    ? selection.address : undefined;
  // Do not silently replace a selected but disconnected external wallet.
  return { linked, active: selected ? linked.find((wallet) => wallet.address === selected) : linked[0] };
}
