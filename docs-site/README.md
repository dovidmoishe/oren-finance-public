# Oren documentation

Independent Fumadocs / Next.js app for `https://docs.oren.finance`. Public guides live in `content/docs/`.

## Local development

Use Node 22+ and pnpm 11.22.0:

```sh
cd docs-site
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3002`; the root redirects straight to the introduction at `/docs`. The site uses the documentation sidebar and search throughout, without a separate marketing landing page. No wallet providers, app secrets or API credentials are required. The docs do not make authenticated product API requests.

```sh
node scripts/validate-content.mjs
pnpm build
pnpm types:check
pnpm start --port 3002
```

The content check verifies document links, navigation and public tool names against `../api/src/mcp-auth/mcp-resource.ts`. Public content documents MCP tools only; internal agent inventories belong in the repository's engineering docs. Build compiles every MDX page and generates the search index, metadata and agent exports.

## Editing

Add MDX under `content/docs/` with `title` and `description` frontmatter. Add it to the folder's `meta.json` navigation. Keep examples consistent with the current API implementation. SDK and public REST pages are explicitly planned; do not invent published package names or stable endpoints.

Use Hugeicons for interface controls. The Webpack alias in `next.config.mjs` maps Fumadocs' built-in icon imports to `components/fumadocs-icons.tsx`, keeping search, navigation, code-copy and theme controls on the same icon set. When upgrading Fumadocs, extend that adapter for any new icon imports. Keep the `--webpack` build/dev flags.

`components/brand/oren-logo.tsx` replicates the web app's component with only its `cn` import adapted to this app. Its companion CSS copies the web logo's styles and reduced-motion rules from `app/app/globals.css`. Preserve the gradient shell, dark face, eye geometry and animation behavior when syncing changes. The favicon at `public/oren-logo.svg` is copied directly from `app/public/oren-mark.svg`. Typography uses self-hosted Instrument Sans Variable.

Search is local to the docs through `/api/search`; no external search service is required. `/llms.txt`, `/llms-full.txt` and `/llms.mdx/docs/<slug>/content.md` provide agent-readable content. The product MCP server remains `https://api.oren.finance/mcp`; this app does not host a trading MCP server.

