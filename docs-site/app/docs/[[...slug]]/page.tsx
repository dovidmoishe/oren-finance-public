import { source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getPageImageUrl, getPageMarkdownUrl } from '@/lib/shared';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ enabled: page.slugs.length > 0 }}
      tableOfContentPopover={{ enabled: page.slugs.length > 0 }}
      breadcrumb={{ enabled: page.slugs.length > 0 }}
      footer={{ enabled: page.slugs.length > 0 }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      {page.slugs.length > 0 && <a className="mb-[24px] mt-[12px] inline-block text-[12px] text-fd-muted-foreground underline underline-offset-[4px]" href={markdownUrl}>Read as Markdown</a>}
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
