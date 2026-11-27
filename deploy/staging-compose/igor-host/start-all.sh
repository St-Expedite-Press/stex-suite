#!/usr/bin/env bash
# Starts the staging Igor host: fake provider, Hermes gateway (igor profile, API server on
# loopback), inference (remote transport), a loopback forwarder to the platform API, and Igor.
# Each runs as the same user as on the VM (hermes for the gateway, stex for Igor and inference).
# Secrets come from the environment (generated per run by the verifier) and are written only
# into the profile's .env (mode 600). If any process exits, the container stops.
set -euo pipefail
: "${STEX_STAGING_API_SERVER_KEY:?}" "${STEX_STAGING_INFERENCE_SECRET:?}"
# Run a command as a service user with that user's own environment (setpriv keeps root's otherwise).
# Background services are started with these arrays inline (never through a function), so $! is
# the service's own PID through the exec chain and a stop signal reaches it.
HERMES=(setpriv --reuid=hermes --regid=hermes --init-groups env HOME=/home/hermes USER=hermes LOGNAME=hermes)
STEX=(setpriv --reuid=stex --regid=stex --init-groups env HOME=/home/stex USER=stex LOGNAME=stex)

# Hermes profile secrets, as on the VM (~hermes/.hermes/profiles/igor/.env). The provider key is a
# placeholder: the provider is the local fake, and no other provider is reachable.
env_file=/home/hermes/.hermes/profiles/igor/.env
install -m 600 -o hermes -g hermes /dev/null "$env_file"
cat > "$env_file" <<EOF
OPENROUTER_API_KEY=staging-fake-provider-key
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=${STEX_STAGING_API_SERVER_KEY}
EOF
# Staging deviation, the only one: the main model's base URL is the recording fake provider.
"${HERMES[@]}" bash -lc 'cd ~/hermes-agent && source ./activate >/dev/null 2>&1 && hermes -p igor config set model.base_url http://127.0.0.1:9999/api/v1 >/dev/null 2>&1'

pids=()
# This script is PID 1: pass a stop on to every service and wait, so Hermes, Igor and inference
# shut down cleanly (as systemd would stop them) instead of being killed when the grace period ends.
trap 'kill -TERM "${pids[@]}" 2>/dev/null; wait; exit 0' TERM INT
"${STEX[@]}" node /srv/staging/fake-provider.mjs & pids+=($!)
"${HERMES[@]}" bash -lc 'cd ~/hermes-agent && source ./activate >/dev/null 2>&1 && exec hermes -p igor gateway run' > /tmp/hermes-gateway.log 2>&1 & pids+=($!)
socat TCP-LISTEN:4340,bind=127.0.0.1,fork,reuseaddr TCP:platform:4340 & pids+=($!)
for i in $(seq 1 120); do curl -fsS -o /dev/null -H "Authorization: Bearer ${STEX_STAGING_API_SERVER_KEY}" http://127.0.0.1:8642/health && break; sleep 1; done
cd /srv/stex/stex-igor/services/inference
setpriv --reuid=stex --regid=stex --init-groups env \
  STEX_INFERENCE_SHARED_SECRET="$STEX_STAGING_INFERENCE_SECRET" STEX_INFERENCE_STATE_DIR=/data/inference STEX_INFERENCE_CATALOG_URL=off \
  STEX_HERMES_TRANSPORT=remote STEX_HERMES_URL=http://127.0.0.1:8642 STEX_HERMES_API_KEY="$STEX_STAGING_API_SERVER_KEY" \
  STEX_HERMES_ISOLATION=verified STEX_HERMES_TOOL_POLICY=conversational-only \
  node server.mjs & pids+=($!)
cd /srv/stex/stex-igor/apps/igor
setpriv --reuid=stex --regid=stex --init-groups env \
  STEX_INFERENCE_URL=http://127.0.0.1:8100 STEX_INFERENCE_SHARED_SECRET="$STEX_STAGING_INFERENCE_SECRET" \
  STEX_KNOWLEDGE_URL=http://127.0.0.1:4340 STEX_KNOWLEDGE_IGOR_SECRET="${STEX_STAGING_KNOWLEDGE_IGOR_SECRET:?}" \
  node server.mjs & pids+=($!)
wait -n "${pids[@]}"
echo "a staging Igor host process exited; stopping" >&2
kill "${pids[@]}" 2>/dev/null || true
exit 1
