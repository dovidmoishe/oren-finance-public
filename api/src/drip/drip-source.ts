import type { DripSourceKind } from './drip.types';

const PLATFORM_KIND: Record<string, DripSourceKind> = {
  TWITTER: 'x_post',
  X: 'x_post',
  SUBSTACK: 'substack',
  PODCAST: 'podcast',
  PODCAST_RSS: 'podcast',
  BEEHIIV: 'newsletter',
  EMAIL: 'newsletter',
  RSS: 'newsletter',
  GENERIC_RSS: 'newsletter',
  YOUTUBE: 'video',
  BOOK: 'other',
};

const SOURCE_LABEL: Record<DripSourceKind, string> = {
  x_post: 'X post',
  substack: 'Substack',
  podcast: 'Podcast',
  newsletter: 'Newsletter',
  video: 'Video',
  article: 'Article',
  other: 'Post',
};

export function sourceLabel(kind: DripSourceKind): string {
  return SOURCE_LABEL[kind];
}

export function classifyDripSource(input: {
  platform?: string;
  url?: string;
  slug?: string;
  guest?: boolean;
}): DripSourceKind {
  const fromPlatform = kindFromPlatform(input.platform);
  if (fromPlatform) return fromPlatform;
  const fromUrl = kindFromHost(hostOf(input.url));
  if (fromUrl) return fromUrl;
  const fromSlug = kindFromHost(hostOfSlug(input.slug));
  if (fromSlug) return fromSlug;
  if (input.guest) return 'podcast';
  if (hostOf(input.url) || hostOfSlug(input.slug)) return 'article';
  return 'other';
}

/** Short link text: a person's name, or @handle when the author is the handle. */
export function dripLinkLabel(author: string, url?: string): string {
  const handle = xHandle(url);
  const trimmed = author.trim();
  if (handle && isHandleLike(trimmed)) return `@${handle}`;
  return trimmed;
}

function kindFromPlatform(
  value: string | undefined,
): DripSourceKind | undefined {
  if (!value) return undefined;
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return PLATFORM_KIND[key];
}

function kindFromHost(host: string | undefined): DripSourceKind | undefined {
  if (!host) return undefined;
  const normalized = host.replace(/^www\./, '').toLowerCase();
  if (
    normalized === 'x.com' ||
    normalized === 'twitter.com' ||
    normalized === 'mobile.twitter.com' ||
    normalized.endsWith('.x.com')
  ) {
    return 'x_post';
  }
  if (normalized === 'substack.com' || normalized.endsWith('.substack.com')) {
    return 'substack';
  }
  if (normalized === 'beehiiv.com' || normalized.endsWith('.beehiiv.com')) {
    return 'newsletter';
  }
  if (
    normalized === 'youtube.com' ||
    normalized === 'm.youtube.com' ||
    normalized === 'youtu.be'
  ) {
    return 'video';
  }
  if (
    normalized === 'spotify.com' ||
    normalized === 'open.spotify.com' ||
    normalized === 'podcasts.apple.com' ||
    normalized === 'overcast.fm' ||
    normalized === 'pocketcasts.com' ||
    normalized === 'pca.st'
  ) {
    return 'podcast';
  }
  if (normalized === 'zastocks.com' || normalized.endsWith('.zastocks.com')) {
    return 'newsletter';
  }
  return undefined;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function hostOfSlug(slug: string | undefined): string | undefined {
  if (!slug || !slug.includes('.')) return undefined;
  return slug.split('/')[0];
}

function xHandle(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (
      host !== 'x.com' &&
      host !== 'twitter.com' &&
      host !== 'mobile.twitter.com'
    ) {
      return undefined;
    }
    const [handle] = parsed.pathname.split('/').filter(Boolean);
    if (
      !handle ||
      handle === 'i' ||
      handle === 'intent' ||
      handle === 'share'
    ) {
      return undefined;
    }
    return handle;
  } catch {
    return undefined;
  }
}

function isHandleLike(author: string): boolean {
  return /^@?[A-Za-z0-9_]{2,30}$/.test(author);
}
