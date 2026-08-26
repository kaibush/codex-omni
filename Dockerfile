FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @codex-omni/protocol build \
  && pnpm --filter @codex-omni/db build \
  && pnpm --filter @codex-omni/codex-runtime build \
  && pnpm --filter @codex-omni/server build \
  && pnpm --filter @codex-omni/web build

FROM node:22-bookworm-slim
WORKDIR /app
ARG CODEX_OMNI_VERSION=""
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV NODE_ENV=production \
    CODEX_OMNI_HOST=0.0.0.0 \
    CODEX_OMNI_PORT=8790 \
    CODEX_OMNI_DATABASE=/app/data/codex-omni.db \
    CODEX_OMNI_VERSION=${CODEX_OMNI_VERSION} \
    COOKIE_SECURE=true
EXPOSE 8790
VOLUME ["/app/data"]
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
