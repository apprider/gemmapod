# Multi-stage Docker image for @gemmapod/origin.
#
# Layer plan:
#   1. `builder` — Node 22 + native build toolchain. Installs the workspace
#      with `pnpm` so `node-datachannel` rebuilds against Debian's libcs.
#      Builds the @gemmapod/core WASM (we need pkg-node for the verifier)
#      and the origin TypeScript.
#   2. `runtime` — slim image with only Node 22 and the production deps.
#      No source, no Rust, no dev tooling.
#
# Distributes as `ghcr.io/gemmapod/origin:<version>`. Run with:
#   docker run --rm \
#     -e SIGNAL_URL=wss://example/signal \
#     -e POD_ID=my-pod \
#     -e OLLAMA_URL=http://host.docker.internal:11434 \
#     ghcr.io/gemmapod/origin:latest

# ---------- builder ----------
FROM node:22-bookworm AS builder
WORKDIR /repo

# Native compile chain for node-datachannel + Rust toolchain for @gemmapod/core.
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

# Copy in just what's needed to build origin + its deps. Order is chosen
# so `pnpm install` caches when only application code changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY .changeset ./.changeset
COPY packages/core/Cargo.toml packages/core/Cargo.lock ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/core/scripts ./packages/core/scripts
COPY packages/core/package.json ./packages/core/
COPY packages/dartc/package.json ./packages/dartc/
COPY packages/origin/package.json ./packages/origin/

RUN pnpm install --frozen-lockfile --filter "@gemmapod/core" --filter "@gemmapod/dartc" --filter "@gemmapod/origin"

# Build order: WASM → dartc → origin.
COPY packages/dartc ./packages/dartc
COPY packages/origin ./packages/origin
RUN pnpm --filter "@gemmapod/core" build \
 && pnpm --filter "@gemmapod/dartc" build \
 && pnpm --filter "@gemmapod/origin" build

# Prune dev deps so the runtime image only carries production artefacts.
RUN pnpm --filter "@gemmapod/origin" --prod deploy /pruned

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# node-datachannel ships prebuilds; runtime libstdc++ is enough.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /pruned ./
USER node
ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/daemon.js"]
