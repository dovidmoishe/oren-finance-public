# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The store mount is a different filesystem from the image layer.
ENV pnpm_config_store_dir=/pnpm/store
ENV pnpm_config_package_import_method=copy
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Mounts reuse the store and the full-metadata mirror on a warm builder.
# The verification record is copied into the layer so a GitHub Actions
# layer-cache hit still skips the registry (mounts are not in that cache).
RUN --mount=type=cache,id=oren-app-pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=oren-app-pnpm-cache,target=/pnpm/cache,sharing=locked \
    pnpm_config_cache_dir=/pnpm/cache pnpm install --frozen-lockfile \
    && mkdir -p /app/.pnpm-cache \
    && cp -a /pnpm/cache/lockfile-verified.jsonl /app/.pnpm-cache/lockfile-verified.jsonl

FROM dependencies AS build
ARG NEXT_PUBLIC_OREN_API_URL
ENV NEXT_PUBLIC_OREN_API_URL=$NEXT_PUBLIC_OREN_API_URL
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID
ARG NEXT_PUBLIC_MCP_SIGNER_POLICY_ID
ENV NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID=$NEXT_PUBLIC_MCP_SIGNER_QUORUM_ID
ENV NEXT_PUBLIC_MCP_SIGNER_POLICY_ID=$NEXT_PUBLIC_MCP_SIGNER_POLICY_ID
ARG NEXT_PUBLIC_DEPLOYMENT_ENV=production
ARG NEXT_PUBLIC_PREVIEW_PR_NUMBER
ARG NEXT_PUBLIC_COMMIT_SHA
ENV NEXT_PUBLIC_DEPLOYMENT_ENV=$NEXT_PUBLIC_DEPLOYMENT_ENV
ENV NEXT_PUBLIC_PREVIEW_PR_NUMBER=$NEXT_PUBLIC_PREVIEW_PR_NUMBER
ENV NEXT_PUBLIC_COMMIT_SHA=$NEXT_PUBLIC_COMMIT_SHA
COPY . ./
# The source layer changes every release, so this step never hits the layer
# cache. Turbopack's compile cache lives under .next/cache; keep that in the
# release builder instead of the image.
RUN mkdir -p .next
RUN --mount=type=cache,id=oren-app-next-cache,target=/app/.next/cache,sharing=locked \
    node scripts/validate-mcp-signer-config.mjs && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
