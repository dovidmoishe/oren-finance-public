import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Standalone packaging runs in Linux Docker; local Windows builds need no symlinks.
  output: process.env.DOCS_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  webpack(config) {
    config.resolve.alias['lucide-react$'] = fileURLToPath(new URL('./components/fumadocs-icons.tsx', import.meta.url));
    return config;
  },
};

export default withMDX(config);
