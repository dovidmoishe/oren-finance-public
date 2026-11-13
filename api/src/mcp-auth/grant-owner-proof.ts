import { createPublicKey, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';

const PREFIX = 'Oren chat trading permission\n';
export const grantTermsSchema = z
  .object({
    perTradeUsd: z.string().regex(/^(?:0|[1-9]\d*)\.\d{6}$/),
    dailyUsd: z.string().regex(/^(?:0|[1-9]\d*)\.\d{6}$/),
    maxSlippageBps: z.number().int().min(1).max(50),
    allowSell: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict();
const ownerMessageSchema = z
  .object({
    version: z.literal(1),
    appId: z.string().min(1),
    action: z.enum(['prepare', 'activate', 'revoke']),
    nonce: z.uuid(),
    issuedAt: z.number().int(),
    validUntil: z.number().int(),
    userId: z.string().min(1).max(256),
    walletId: z.string().min(1).max(256),
    wallet: z.string().min(32).max(64),
    delegationId: z.uuid(),
    signerId: z.string().min(1).max(256).nullable(),
    policyId: z.string().min(1).max(256).nullable(),
    terms: grantTermsSchema.nullable(),
  })
  .strict();
export type OwnerMessage = z.infer<typeof ownerMessageSchema>;
export type GrantTerms = z.infer<typeof grantTermsSchema>;
export const ownerProofSchema = z
  .object({
    message: z.string().max(4096),
    signature: z.string().max(88),
  })
  .strict();
export type OwnerProof = z.infer<typeof ownerProofSchema>;

export function ownerPermissionMessage(value: OwnerMessage) {
  return PREFIX + JSON.stringify(ownerMessageSchema.parse(value));
}

/** The gate receives a bounded owner proof, never a reusable Privy session JWT. */
export function verifyOwnerProof(
  proof: OwnerProof,
  appId: string,
  action: OwnerMessage['action'],
) {
  ownerProofSchema.parse(proof);
  if (!proof.message.startsWith(PREFIX))
    throw new Error('Wrong permission domain');
  const value = ownerMessageSchema.parse(
    JSON.parse(proof.message.slice(PREFIX.length)),
  );
  const now = Date.now();
  if (
    value.appId !== appId ||
    value.action !== action ||
    value.issuedAt > now + 5_000 ||
    value.validUntil <= now ||
    value.validUntil <= value.issuedAt ||
    value.validUntil - value.issuedAt > 300_000 ||
    proof.message !== ownerPermissionMessage(value)
  )
    throw new Error('Permission proof is expired or has different terms');
  const signature = Buffer.from(proof.signature, 'base64');
  if (
    signature.length !== 64 ||
    signature.toString('base64') !== proof.signature
  )
    throw new Error('Invalid permission signature');
  const key = createPublicKey({
    format: 'der',
    type: 'spki',
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      new PublicKey(value.wallet).toBuffer(),
    ]),
  });
  if (!verify(null, Buffer.from(proof.message), key, signature))
    throw new Error('Wallet did not authorize these permission terms');
  if (
    action !== 'revoke' &&
    (!value.terms ||
      (value.terms.expiresAt !== null &&
        Date.parse(value.terms.expiresAt) <= now))
  )
    throw new Error('Permission terms are unavailable');
  return value;
}

export function sameGrantTerms(
  value: OwnerMessage,
  grant: {
    id: string;
    userId: string;
    walletId: string;
    wallet: string;
    signerId: string;
    policyId: string;
    perTradeLimitUsd: string;
    dailyLimitUsd: string;
    maxSlippageBps: number;
    allowSell: boolean;
    expiresAt: Date | null;
  },
) {
  return (
    value.delegationId === grant.id &&
    value.userId === grant.userId &&
    value.walletId === grant.walletId &&
    value.wallet === grant.wallet &&
    value.signerId === grant.signerId &&
    value.policyId === grant.policyId &&
    value.terms?.perTradeUsd === grant.perTradeLimitUsd &&
    value.terms.dailyUsd === grant.dailyLimitUsd &&
    value.terms.maxSlippageBps === grant.maxSlippageBps &&
    value.terms.allowSell === grant.allowSell &&
    value.terms.expiresAt === (grant.expiresAt?.toISOString() ?? null)
  );
}
