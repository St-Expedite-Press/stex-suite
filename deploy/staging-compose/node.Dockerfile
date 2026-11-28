# syntax=docker/dockerfile:1
# Pantheon and Frige images for the local staging slice (deploy/staging-compose).
# Build context: the repository root (see /.dockerignore). Base images are pinned
# by digest; the Node version matches CI (docs/STATUS.md, developer toolchain).

FROM node:22.23.5-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS node-base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production

# Workspace install: only the packages the two services import, production dependencies only.
FROM node-base AS workspace
WORKDIR /srv/stex
COPY . .
RUN corepack enable \
 && corepack pnpm install --frozen-lockfile --prod \
      --filter @stex/pantheon --filter @stex/frige --filter @stex/knowledge --filter @stex/design-system

# Pantheon: shell, composed workspaces and routing. Runs as the unprivileged node user;
# the application tree is root-owned and read-only to it.
FROM node-base AS pantheon
COPY --from=workspace /srv/stex /srv/stex
WORKDIR /srv/stex/apps/pantheon
USER node
EXPOSE 4300
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4300/home/').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.mjs"]

# Frige: the publishing engine with the same TeX packages the VM installs
# (stex-igor/deploy/pantheon/setup-pantheon-host.sh). State lives only under /data/frige.
FROM node-base AS frige
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends texlive-luatex texlive-latex-recommended lmodern \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/frige \
 && chown node:node /data/frige
COPY --from=workspace /srv/stex /srv/stex
WORKDIR /srv/stex/apps/frige
USER node
ENV TEXMFVAR=/tmp/texmf-var
EXPOSE 4310
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/frige/api/stex/projects').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.mjs"]

# Igor (hosted overlay): its interface is built here with build-time dependencies, then
# served by the same server.mjs the VM runs. Accounts come from a mounted fixture file.
FROM node-base AS igor-build
WORKDIR /srv/stex
COPY . .
RUN corepack enable  && NODE_ENV=development corepack pnpm install --frozen-lockfile --filter @stex/igor... --filter @stex/inference...  && corepack pnpm --dir stex-igor/apps/igor build

FROM node-base AS igor
COPY --from=igor-build /srv/stex /srv/stex
RUN mkdir -p /data/igor && chown node:node /data/igor
WORKDIR /srv/stex/stex-igor/apps/igor
USER node
EXPOSE 4330
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6   CMD ["node", "-e", "fetch('http://127.0.0.1:4330/igor/login').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.mjs"]
