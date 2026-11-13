import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.oren.finance'),
  title: { default: 'Oren Docs', template: '%s | Oren Docs' },
  description: 'Connect your AI tools to Oren. Guides for MCP, wallet permissions, stock research and developer integrations.',
  icons: { icon: '/oren-logo.svg' },
  openGraph: { siteName: 'Oren Docs', type: 'website' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html className="[scrollbar-gutter:stable]" lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
