# syntax=docker/dockerfile:1
###############################################################################
# Snoat backend – bygge-motoren.
#
# Imaget inneholder tre verktøy utover Node:
#   git            – kloner brukerens repository
#   docker (CLI)   – nixpacks shell-er ut til `docker build`
#   nixpacks       – standard bygge-motor (auto-detekterer rammeverk)
#
# Containeren snakker med host-maskinens Docker-daemon via montert socket, den
# kjører ingen daemon selv.
###############################################################################

FROM node:22-bookworm-slim AS base

ARG DOCKER_CLI_VERSION=27.5.1
ARG NIXPACKS_VERSION=1.41.0
ARG BUILDX_VERSION=0.36.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates curl git openssh-client tar xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Docker CLI (statisk binary – vi trenger klienten, ikke daemonen).
RUN set -eux; \
  arch="$(uname -m)"; \
  curl -fsSL "https://download.docker.com/linux/static/stable/${arch}/docker-${DOCKER_CLI_VERSION}.tgz" -o /tmp/docker.tgz; \
  tar -xzf /tmp/docker.tgz -C /tmp docker/docker; \
  mv /tmp/docker/docker /usr/local/bin/docker; \
  rm -rf /tmp/docker /tmp/docker.tgz; \
  docker --version

# Buildx – CLI-plugin, ikke del av den statiske docker-tarballen over.
#
# Docker CLI 27 har BuildKit på som standard, og BuildKit *er* buildx. Uten
# pluginen feiler hver `docker build` med «BuildKit is enabled but the buildx
# component is missing», og siden nixpacks shell-er ut til docker build betyr
# det at ingen deploy kan lykkes. Nixpacks-genererte Dockerfiler bruker dessuten
# `RUN --mount=type=cache`, som den gamle byggeren ikke forstår – å skru av
# BuildKit er derfor ingen vei rundt.
RUN set -eux; \
  case "$(uname -m)" in \
    x86_64)  arch=amd64 ;; \
    aarch64) arch=arm64 ;; \
    *) echo "Ustøttet arkitektur: $(uname -m)" >&2; exit 1 ;; \
  esac; \
  mkdir -p /usr/local/lib/docker/cli-plugins; \
  curl -fsSL "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-${arch}" \
    -o /usr/local/lib/docker/cli-plugins/docker-buildx; \
  chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx; \
  docker buildx version

# Nixpacks – https://github.com/railwayapp/nixpacks
# Vi laster ned release-artefakten direkte i stedet for install.sh, fordi
# install.sh alltid henter siste versjon og dermed gir ureproduserbare builds.
RUN set -eux; \
  case "$(uname -m)" in \
    x86_64)  target=x86_64-unknown-linux-musl ;; \
    aarch64) target=aarch64-unknown-linux-musl ;; \
    *) echo "Ustøttet arkitektur: $(uname -m)" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-${target}.tar.gz" -o /tmp/nixpacks.tgz; \
  tar -xzf /tmp/nixpacks.tgz -C /usr/local/bin nixpacks; \
  rm /tmp/nixpacks.tgz; \
  nixpacks --version

WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
