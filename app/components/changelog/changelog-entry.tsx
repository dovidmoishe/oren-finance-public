
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Image from 'next/image';
import Link from 'next/link';
import type { ChangelogEntry as Entry } from '@/content/changelog/model.mjs';
import { formatReleaseDate } from '@/content/changelog/model.mjs';

export function ChangelogEntry({ entry, detail = false }: { entry: Entry; detail?: boolean }) {
  const Heading = detail ? 'h1' : 'h2';
  const ChangeHeading = detail ? 'h2' : 'h3';
  const captionId = `${entry.slug}-caption`;
  const hasMedia = !!entry.video || !!entry.screenshots?.length;
  return <article className="changelog-entry" aria-labelledby={`${entry.slug}-title`}>
    <header className="mb-[26px] at-most-767:mb-[22px]">
      <div className="changelog-entry-meta"><time dateTime={entry.date}>{formatReleaseDate(entry.date)}</time>{entry.status === 'draft' && <span>Draft preview</span>}</div>
      <Heading id={`${entry.slug}-title`} className="changelog-title">{detail ? entry.title : <Link href={`/changelog/${entry.slug}`}>{entry.title}</Link>}</Heading>
    </header>
    <div className={hasMedia ? "changelog-story-with-media" : "changelog-story"}>
      {hasMedia && <div className="changelog-media">
        {entry.video && <figure className="changelog-film">
          <video controls playsInline preload="none" width={entry.video.width} height={entry.video.height} poster={entry.video.poster} aria-label={entry.video.label} aria-describedby={captionId}>
            <source src={entry.video.src} type="video/mp4" />
            <a href={entry.video.src}>Watch the film</a>
          </video>
          <figcaption id={captionId}>{entry.video.caption}</figcaption>
        </figure>}
        {entry.screenshots?.map(image => <figure className="changelog-screenshot" key={image.src}>
          <Image src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 767px) 100vw, 640px" unoptimized />
        </figure>)}
      </div>}
      <div className="min-w-0">
        <p className="text-[15px] leading-[1.8] text-[#514c45] at-most-767:text-[14px]">{entry.summary}</p>
        {entry.sections?.map(section => <section className="changelog-changes" key={section.heading} aria-label={section.heading}>
          <ul>{section.items.map((item, index) => <li key={index}>{typeof item === 'string' ? <p>{item}</p> : <><ChangeHeading>{item.title}</ChangeHeading><p>{item.description}</p></>}</li>)}</ul>
        </section>)}
        <div className="flex flex-wrap items-center [gap:8px_24px] mt-[22px]">
          {entry.links?.map(link => <Link className="changelog-feature-link" key={link.href} href={link.href}>{link.label}<span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></Link>)}
          {!detail && <Link className="changelog-permalink" href={`/changelog/${entry.slug}`} aria-label={`Permalink: ${entry.title}`}>Full update <span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></Link>}
        </div>
      </div>
    </div>
  </article>;
}
