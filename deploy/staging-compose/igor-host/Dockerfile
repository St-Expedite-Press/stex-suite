# syntax=docker/dockerfile:1
# The staging "Igor host": Igor, the inference service, the Hermes gateway and a recording fake
# model provider on one Debian 12 machine's loopback, as on the VM (stex-igor/docs/operations).
#
# Hermes is installed with the VM's managed recipe: a git checkout of the exact pin and
# `./setup-hermes.sh --runtime-only` as the `hermes` user (upstream's pm: pinned uv, Python and
# hash-verified dependencies from uv.lock). The pinned runtime arrives as the named build context
# `hermes` (a shallow clone of the pin; see scripts/verify/verify-staging-igor.mjs).
# The Obsidian connector is installed into the `igor` profile at the exact SHA in
# stex-igor/hermes/eval/pins.json, never the live catalog default.
# Build has network; the running container sits on an internal network with no outside access.

FROM debian:bookworm-slim@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e AS host
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates git curl bash socat procps util-linux xz-utils libatomic1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1001 --create-home --shell /bin/bash hermes \
 && useradd --uid 1002 --create-home --shell /bin/bash stex
COPY --from=node:22.23.5-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb /usr/local/bin/node /usr/local/bin/node

# Managed Hermes install, exactly as on the VM.
# The checkout's own .dockerignore drops .git and other tracked files, so the git metadata comes
# in as its own context (`hermes-git`) and `git reset --hard` restores the exact tracked tree.
COPY --from=hermes --chown=hermes:hermes . /home/hermes/hermes-agent
COPY --from=hermes-git --chown=hermes:hermes . /home/hermes/hermes-agent/.git
USER hermes
WORKDIR /home/hermes/hermes-agent
ARG STEX_STAGING_HERMES_SHA
RUN git reset -q --hard HEAD \
 && test -n "$STEX_STAGING_HERMES_SHA" && test "$(git rev-parse HEAD)" = "$STEX_STAGING_HERMES_SHA" \
 && test -z "$(git status --porcelain)" \
 && ./setup-hermes.sh --runtime-only

# The igor profile: STEX's own settings (deploy/hermes/apply-igor-profile.sh, read as code),
# the connector at its pinned SHA, and only the Markdown, Bases and Canvas skills active.
COPY --chown=hermes:hermes stex-igor/deploy/hermes/apply-igor-profile.sh /home/hermes/stex/apply-igor-profile.sh
COPY --chown=hermes:hermes stex-igor/hermes/eval/pins.json /home/hermes/stex/pins.json
COPY --chown=hermes:hermes deploy/staging-compose/igor-host/configure-hermes.sh /home/hermes/stex/configure-hermes.sh
ARG STEX_STAGING_INSTALL_CONNECTOR=1
RUN STEX_STAGING_INSTALL_CONNECTOR=$STEX_STAGING_INSTALL_CONNECTOR bash /home/hermes/stex/configure-hermes.sh

# Igor and the inference service: the workspace from the `igor` target of node.Dockerfile,
# passed in as the named build context `igor-workspace` (an image built just before).
USER root
COPY --from=igor-workspace /srv/stex /srv/stex
COPY deploy/staging-compose/igor-host/fake-provider.mjs /srv/staging/fake-provider.mjs
COPY deploy/staging-compose/igor-host/start-all.sh /srv/staging/start-all.sh
RUN mkdir -p /data/igor /data/inference /tmp/provider \
 && chown stex:stex /data/igor /data/inference /tmp/provider \
 && chmod 0755 /srv/staging/start-all.sh
EXPOSE 4330
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4330/igor/login').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["/srv/staging/start-all.sh"]
