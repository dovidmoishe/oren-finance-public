import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** Every field a signed profile update may write. */
export interface ProfileChangeTerms {
  walletAddress: string;
  isPublic: boolean;
  slug: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
}

const TITLE = 'Oren social profile update';
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PENDING = 10_000;

/**
 * The exact text the wallet signs. Free-text fields are JSON-encoded so a
 * display name or bio cannot add lines that look like other fields.
 */
export function profileChangeMessage(
  terms: ProfileChangeTerms,
  nonce: string,
  expiresAt: Date,
): string {
  return [
    TITLE,
    `Wallet: ${terms.walletAddress}`,
    `Public: ${terms.isPublic ? 'true' : 'false'}`,
    `Slug: ${terms.slug}`,
    `Display name: ${JSON.stringify(terms.displayName)}`,
    `Avatar URL: ${terms.avatarUrl ? JSON.stringify(terms.avatarUrl) : 'none'}`,
    `Bio: ${terms.bio ? JSON.stringify(terms.bio) : 'none'}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt.toISOString()}`,
  ].join('\n');
}

interface PendingChallenge {
  terms: ProfileChangeTerms;
  message: string;
  expiresAt: number;
}

/**
 * Server-issued, single-use challenges for profile updates. The API runs as a
 * single instance, so pending challenges live in memory; a restart only means
 * the user signs a fresh one.
 */
@Injectable()
export class ProfileChallenges {
  private readonly pending = new Map<string, PendingChallenge>();

  issue(terms: ProfileChangeTerms, now = Date.now()) {
    this.prune(now);
    const nonce = randomUUID();
    const expiresAt = new Date(now + CHALLENGE_TTL_MS);
    const message = profileChangeMessage(terms, nonce, expiresAt);
    this.pending.set(nonce, {
      terms: { ...terms },
      message,
      expiresAt: expiresAt.getTime(),
    });
    return { message, expiresAt };
  }

  /** The challenge this message answers, without consuming it. */
  find(walletAddress: string, message: string, now = Date.now()) {
    const nonce = /^Nonce: ([0-9a-f-]{36})$/m.exec(message)?.[1];
    const challenge = nonce ? this.pending.get(nonce) : undefined;
    if (
      !nonce ||
      !challenge ||
      challenge.expiresAt <= now ||
      challenge.message !== message ||
      challenge.terms.walletAddress !== walletAddress
    )
      throw new BadRequestException(
        'Profile update expired or was already used. Review and sign it again.',
      );
    return { nonce, terms: { ...challenge.terms } };
  }

  /** Single use: a consumed challenge can never be replayed. */
  consume(nonce: string): boolean {
    return this.pending.delete(nonce);
  }

  private prune(now: number) {
    for (const [nonce, challenge] of this.pending)
      if (challenge.expiresAt <= now) this.pending.delete(nonce);
    for (const nonce of this.pending.keys()) {
      if (this.pending.size < MAX_PENDING) break;
      this.pending.delete(nonce);
    }
  }
}

const MAX_AVATAR_URL_LENGTH = 512;
const MAX_BIO_LENGTH = 280;

/** Avatars render as <img> for every viewer: HTTPS only, no embedded credentials. */
export function normalizeAvatarUrl(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestException('avatarUrl must be a valid https URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.href.length > MAX_AVATAR_URL_LENGTH
  )
    throw new BadRequestException('avatarUrl must be a valid https URL');
  return url.href;
}

/** Stored values predate validation; never hand a non-https avatar to clients. */
export function safeStoredAvatarUrl(value?: string | null): string | undefined {
  try {
    return normalizeAvatarUrl(value);
  } catch {
    return undefined;
  }
}

export function normalizeBio(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_BIO_LENGTH)
    throw new BadRequestException(
      `bio must be ${MAX_BIO_LENGTH} characters or fewer`,
    );
  return trimmed;
}
