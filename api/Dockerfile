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
# The verification record is copied into the layer so prune, and a GitHub
# Actions layer-cache hit, still skip the registry.
RUN --mount=type=cache,id=oren-api-pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=oren-api-pnpm-cache,target=/pnpm/cache,sharing=locked \
    pnpm_config_cache_dir=/pnpm/cache pnpm install --frozen-lockfile \
    && mkdir -p /app/.pnpm-cache \
    && cp -a /pnpm/cache/lockfile-verified.jsonl /app/.pnpm-cache/lockfile-verified.jsonl

FROM dependencies AS build
COPY . ./
RUN --mount=type=cache,id=oren-api-pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=oren-api-pnpm-cache,target=/pnpm/cache,sharing=locked \
    pnpm_config_cache_dir=/app/.pnpm-cache pnpm build \
    && pnpm_config_cache_dir=/app/.pnpm-cache pnpm prune --prod \
    && chmod -R a+rX lib/db \
    && chmod a+r package.json

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/lib/db ./lib/db
USER node
EXPOSE 3000
CMD ["node", "dist/src/main"]
