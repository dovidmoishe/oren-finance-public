import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isDev = process.env.NODE_ENV !== "production";

/** Origin of NEXT_PUBLIC_OREN_API_URL; previews use a relative path, already covered by 'self'. */
function apiOrigin(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_OREN_API_URL ?? (isDev ? "http://localhost:3000/api" : undefined);
  if (!configured || configured.startsWith("/")) return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    return undefined;
  }
}

// Privy hosts follow https://docs.privy.io/security/implementation-guide/content-security-policy.
// WalletConnect relay/verify and Coinbase Wallet hosts are left out because privy-auth.tsx disables
// external wallets; Privy still reads the WalletConnect wallet list, so that one host stays.
// Retest after every Privy SDK upgrade.
const privy = ["https://auth.privy.io"];
const privyConnect = [...privy, "https://explorer-api.walletconnect.com"];
const turnstile = "https://challenges.cloudflare.com";
const rpc = [
  "https://*.rpc.privy.systems",
  "https://api.mainnet-beta.solana.com",
  "https://api.devnet.solana.com",
  "wss://api.mainnet-beta.solana.com",
  "wss://api.devnet.solana.com",
  "https://solana-mainnet.g.alchemy.com",
  "https://solana-devnet.g.alchemy.com",
  "wss://solana-mainnet.g.alchemy.com",
  "wss://solana-devnet.g.alchemy.com",
  "https://api.jup.ag",
];

const contentSecurityPolicy = [
  ["default-src", "'self'"],
  ["script-src", "'self'", "'unsafe-inline'", turnstile, ...(isDev ? ["'unsafe-eval'"] : [])],
  ["style-src", "'self'", "'unsafe-inline'"],
  ["img-src", "'self'", "data:", "blob:", "https:"],
  ["font-src", "'self'", "data:"],
  ["media-src", "'self'"],
  ["connect-src", "'self'", ...[apiOrigin()].filter((origin): origin is string => Boolean(origin)), ...privyConnect, ...rpc, ...(isDev ? ["ws:"] : [])],
  ["frame-src", ...privy, turnstile],
  ["child-src", ...privy],
  ["worker-src", "'self'", "blob:"],
  ["manifest-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
]
  .map((directive) => directive.join(" "))
  .join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] }];
  },
  outputFileTracingIncludes: {
    "/changelog": ["./content/changelog/*.json"],
    "/changelog/*": ["./content/changelog/*.json"],
  },
  async redirects() {
    return [
      { source: "/activity", destination: "/app/activity", permanent: false },
      { source: "/calendar", destination: "/app/calendar", permanent: false },
      { source: "/deposit", destination: "/app/deposit", permanent: false },
      { source: "/leaderboard/:path*", destination: "/app/leaderboard/:path*", permanent: false },
      { source: "/markets", destination: "/app/markets", permanent: false },
      { source: "/overview", destination: "/app/overview", permanent: false },
      { source: "/portfolio", destination: "/app/portfolio", permanent: false },
      { source: "/stocks/:path*", destination: "/app/stocks/:path*", permanent: false },
      { source: "/vault", destination: "/app/vault", permanent: false },
      { source: "/venues", destination: "/app/venues", permanent: false },
      { source: "/changelog/send-cash-and-stocks", destination: "/changelog/transfer-stablecoins-and-stocks", permanent: true },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
