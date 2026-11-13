
import { ArrowLeft02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangelogEntry } from '@/components/changelog/changelog-entry';
import { getChangelog, getChangelogEntry } from '@/content/changelog';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() { return getChangelog().map(entry => ({ slug: entry.slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = getChangelogEntry((await params).slug);
  if (!entry) notFound();
  if (entry.status === 'draft') return { title: 'Draft preview — Oren', robots: { index: false, follow: false } };
  const url = `/changelog/${entry.slug}`;
  const image = entry.video?.poster ?? entry.screenshots?.[0]?.src;
  return {
    title: `${entry.title} — Oren`, description: entry.summary,
    alternates: { canonical: url },
    openGraph: { title: entry.title, description: entry.summary, url, type: 'article', publishedTime: `${entry.date}T12:00:00Z`, ...(image ? { images: [{ url: image, alt: entry.title }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: entry.title, description: entry.summary, ...(image ? { images: [image] } : {}) },
  };
}

export default async function EntryPage({ params }: Props) {
  const entry = getChangelogEntry((await params).slug);
  if (!entry) notFound();
  return <>
    <Link href="/changelog" className="inline-flex gap-[10px] items-center min-h-[44px] text-[12px] text-[#69665f] [margin:28px_0]"><span aria-hidden="true"><HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span>All updates</Link>
    <div className="[border-top:1px_solid_#e3e0d9] pt-[34px] at-most-767:pt-[28px]">
      <ChangelogEntry entry={entry} detail />
    </div>
  </>;
}
