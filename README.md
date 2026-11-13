# Oren

**Your intelligent investing agent for tokenized stocks on Solana.**

Oren makes it easier to explore, buy, and manage tokenized stocks. You see familiar companies and tickers; Oren handles the token variants, market data, and trading routes behind the scenes.

Connect a Solana wallet to see your portfolio, research a stock, chat with the Oren agent, and review a trade before signing it yourself.

> You think in stocks. Oren handles the onchain complexity.

## What you can do with Oren

- **Explore stocks:** Browse and search supported tokenized equities, then dig into prices, charts, news, and market activity.
- **Understand your portfolio:** See supported holdings, USDC cash, performance snapshots, activity, and a trading calendar in one place.
- **Ask Oren:** Get portfolio-aware answers and stock research backed by market data and calculated signals. The agent can suggest trades and baskets for you to review.
- **Trade with your wallet:** Buy or sell through Jupiter, or set a limit order. Oren prepares the transaction; you review and sign it.
- **Discover traders:** Browse the leaderboard and public profiles, and prepare a copy-portfolio proposal.
- **Plan a longer hold:** View the Oren Vault experience for time-locking stock tokens. Vault transactions are currently disabled until the onchain program is deployed and verified.

The experience is built around a simple flow:

```text
Discover → Research → Review → Sign → Track
```

Oren's intelligence scores and technical indicators are calculated in code. The AI agent explains those results and helps turn ideas into actions, but it never signs a transaction for you.

## How it fits together

Oren uses a **Next.js app** for the website and trading interface, a **NestJS API** for portfolio, market, agent, and execution features, and a **Solana program** for the Vault. Tokens supplies stock and market data; Alchemy reads wallet state; Jupiter provides trading routes. PostgreSQL remembers things like portfolio snapshots, conversations, and executions. Solana remains the source of truth for assets and transactions.

```text
app/       Website and trading interface
api/       Backend, integrations, and database
program/   Solana Vault program
docs-site/ Developer documentation
infra/     Changelog media manifest
```

## Run it locally

You'll need Node.js 22, pnpm 11.22.0, PostgreSQL, and Tokens and Alchemy API keys. A Solana wallet is needed to try wallet flows; an OpenAI API key enables the agent.

1. Copy [`api/.env.example`](api/.env.example) to `api/.env`. Set `POSTGRES_URL`, `TOKENS_API_KEY`, `ALCHEMY_API_KEY`, and `PORT=3001`.
2. Start the API:

   ```powershell
   Set-Location api
   pnpm install --frozen-lockfile
   pnpm db:migrate
   pnpm db:sync-stocks
   pnpm start:dev
   ```

3. In another terminal, start the app:

   ```powershell
   Set-Location app
   'NEXT_PUBLIC_OREN_API_URL=http://localhost:3001/api' | Set-Content .env.local
   pnpm install --frozen-lockfile
   pnpm dev
   ```

Open `http://localhost:3000` for the landing page or `http://localhost:3000/app` for the product. The API runs at `http://localhost:3001/api` with this setup. Keep credentials in local environment files, outside Git.

## Project status

The app includes markets, portfolios, agent chat, trading, baskets, limit orders, social profiles, a calendar, and the Vault interface. Some connected-wallet and production flows still need live verification. Vault transactions require a configured and verified program.

## About this repository

This is a public source snapshot of Oren. Production deployment configuration, operating notes and historical GitHub activity are kept in the production repository. Use your own infrastructure and credentials for local development. Changelog videos are separately hosted.

Oren grants no additional license for its source in this snapshot. Third-party dependencies retain their own licenses. Product and integration names identify their respective owners and do not imply endorsement.

The Solana CI job checks the Rust library. Run the program integration tests after building the SBF artifact with the Anchor toolchain.
