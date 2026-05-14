# Multi-stage Docker image for @gemmapod/cloud.
#
# Layer plan:
#   1. `builder` — Node 22 + Rust toolchain for @gemmapod/core's WASM
#      verifier. Builds core + dartc (transitive) + cloud.
#   2. `runtime` — slim node:22, only production artefacts and deps.
#
# Distributes as `ghcr.io/gemmapod/cloud:<version>`. Run with:
#   docker run --rm -p 8080:8080 -v $(pwd)/data:/data \
#     ghcr.io/gemmapod/cloud:latest \
#     --registry sqlite --data-dir /data

# ---------- builder ----------
FROM node:22-bookworm AS builder
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      cmake \
      curl \
      ca-certificates \
      git \
  && curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown \
  && curl -fsSL https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz \
       | tar -xz --strip-components=1 -C /usr/local/bin wasm-pack-v0.13.1-x86_64-unknown-linux-musl/wasm-pack \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:${PATH}"
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY .changeset ./.changeset
COPY packages/core/Cargo.toml packages/core/Cargo.lock ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/core/scripts ./packages/core/scripts
COPY packages/core/package.json ./packages/core/
COPY packages/cloud/package.json ./packages/cloud/

RUN pnpm install --frozen-lockfile --filter "@gemmapod/core" --filter "@gemmapod/cloud"

COPY packages/cloud ./packages/cloud
RUN pnpm --filter "@gemmapod/core" build \
 && pnpm --filter "@gemmapod/cloud" build

RUN pnpm --filter "@gemmapod/cloud" --prod deploy /pruned

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /pruned ./
USER node
ENV NODE_ENV=production
EXPOSE 8080

ENTRYPOINT ["node", "dist/cli.js"]
CMD []
