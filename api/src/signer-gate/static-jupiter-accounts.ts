import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';

function sameInstruction(a: TransactionInstruction, b: TransactionInstruction) {
  return (
    a.programId.equals(b.programId) &&
    a.data.equals(b.data) &&
    a.keys.length === b.keys.length &&
    a.keys.every(
      (key, index) =>
        key.pubkey.equals(b.keys[index].pubkey) &&
        key.isSigner === b.keys[index].isSigner &&
        key.isWritable === b.keys[index].isWritable,
    )
  );
}

/** Keep Privy-checked accounts static without changing any instruction. */
export async function staticJupiterAccounts(
  encodedTransaction: string,
  protectedKeys: ReadonlySet<string>,
  resolve: (key: PublicKey) => Promise<AddressLookupTableAccount | null>,
) {
  const original = VersionedTransaction.deserialize(
    Buffer.from(encodedTransaction, 'base64'),
  );
  if (
    original.version !== 0 ||
    original.message.header.numRequiredSignatures !== 1 ||
    original.signatures.length !== 1 ||
    original.signatures[0].some((byte) => byte !== 0)
  )
    throw new Error('Jupiter returned an already signed or multi-signer route');
  const tables = await Promise.all(
    original.message.addressTableLookups.map(async ({ accountKey }) => {
      const table = await resolve(accountKey);
      if (!table)
        throw new Error('Jupiter address lookup table is unavailable');
      return table;
    }),
  );
  const originalInstructions = TransactionMessage.decompile(original.message, {
    addressLookupTableAccounts: tables,
  }).instructions;
  const placeholder = Keypair.generate().publicKey;
  const safeTables = tables.map(
    (table) =>
      new AddressLookupTableAccount({
        key: table.key,
        state: {
          ...table.state,
          addresses: table.state.addresses.map((address) =>
            protectedKeys.has(address.toBase58()) ? placeholder : address,
          ),
        },
      }),
  );
  const message = new TransactionMessage({
    payerKey: original.message.staticAccountKeys[0],
    recentBlockhash: original.message.recentBlockhash,
    instructions: originalInstructions,
  }).compileToV0Message(safeTables);
  const rewritten = new VersionedTransaction(message);
  if (rewritten.serialize().length > 1232)
    throw new Error('Static protected accounts exceed the Solana packet limit');
  const rewrittenInstructions = TransactionMessage.decompile(message, {
    addressLookupTableAccounts: tables,
  }).instructions;
  if (
    rewrittenInstructions.length !== originalInstructions.length ||
    rewrittenInstructions.some(
      (instruction, index) =>
        !sameInstruction(instruction, originalInstructions[index]),
    ) ||
    !message.recentBlockhash ||
    message.recentBlockhash !== original.message.recentBlockhash ||
    !protectedKeys.has(message.staticAccountKeys[0].toBase58()) ||
    [...protectedKeys].some(
      (key) =>
        originalInstructions.some(
          (instruction) =>
            instruction.programId.toBase58() === key ||
            instruction.keys.some(
              (account) => account.pubkey.toBase58() === key,
            ),
        ) &&
        !message.staticAccountKeys.some(
          (account) => account.toBase58() === key,
        ),
    )
  )
    throw new Error('Static account recompilation changed the Jupiter route');
  return Buffer.from(rewritten.serialize()).toString('base64');
}
