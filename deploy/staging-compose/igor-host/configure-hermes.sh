#!/usr/bin/env bash
# Configures the staging `igor` Hermes profile at image build time (run as `hermes`).
#
# 1. Creates the profile and applies every setting in deploy/hermes/apply-igor-profile.sh,
#    read from that script so staging cannot drift from production. Its four model pins use
#    the Grok defaults (no stored company configuration exists in staging).
# 2. Installs the official Obsidian connector at the exact SHA in pins.json (--ref), so the
#    live catalog's current default can never be installed instead.
# 3. Keeps only the Markdown, Bases and Canvas skills active.
# Provider keys and the gateway key are written at container start (start-all.sh), never here.
set -euo pipefail
cd ~/hermes-agent
source ./activate >/dev/null 2>&1
hermes profile create igor >/dev/null
pins=~/stex/pins.json
sha=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['obsidian']['sha'])" "$pins")
disabled=$(python -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))['obsidian']['disabled']))" "$pins")
# STEX's profile settings, exactly as the production script lists them.
MODEL_DEFAULT=x-ai/grok-4.7 COMPRESSION_MODEL=x-ai/grok-4.20 TITLE_MODEL=x-ai/grok-4.3 DELEGATION_MODEL=x-ai/grok-4.7
applied=0
while IFS= read -r line; do
  eval "set -- ${line#set_value }"
  hermes -p igor config set "$1" "$2" >/dev/null 2>&1
  applied=$((applied + 1))
done < <(grep -E '^set_value [^ ]+ ' ~/stex/apply-igor-profile.sh \
  | sed -e "s|\"\$MODEL_DEFAULT\"|$MODEL_DEFAULT|" -e "s|\"\$COMPRESSION_MODEL\"|$COMPRESSION_MODEL|" \
        -e "s|\"\$TITLE_MODEL\"|$TITLE_MODEL|" -e "s|\"\$DELEGATION_MODEL\"|$DELEGATION_MODEL|")
hermes -p igor config unset fallback_model >/dev/null 2>&1 || true
# Fail loudly unless every production setting was applied (model ids contain "/", so sed uses "|").
expected=$(grep -cE '^set_value [^ ]+ ' ~/stex/apply-igor-profile.sh)
test "$applied" -eq "$expected" || { echo "applied $applied of $expected STEX profile settings" >&2; exit 1; }
test "$(hermes -p igor config get model.default 2>/dev/null | tail -1)" = "$MODEL_DEFAULT" || { echo "model.default was not applied" >&2; exit 1; }
echo "applied $applied STEX profile settings"
if [ "${STEX_STAGING_INSTALL_CONNECTOR:-1}" != "1" ]; then
  echo "connector not installed in this image (rollback image; the profile comes from the existing volume)"
  exit 0
fi
hermes -p igor plugins install obsidian --ref "$sha" --enable --yes-deps
hermes -p igor config set skills.disabled "$disabled" >/dev/null 2>&1
recorded=$(python -c "import json; print(json.load(open('$HOME/.hermes/profiles/igor/plugins/obsidian/.hermes-catalog.json'))['sha'])")
test "$recorded" = "$sha" || { echo "connector installed at $recorded, expected $sha" >&2; exit 1; }
echo "connector pinned at $recorded"
