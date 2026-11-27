#!/usr/bin/env bash
# A5 offline check, run as root inside the Igor-host image with `--network none`
# (scripts/verify/verify-hermes-offline.mjs). Writes the igor profile's secrets as on the VM
# (the provider key is a placeholder; no provider is reachable), starts the gateway, waits for
# health, stops it with SIGTERM as systemd does, starts it again and checks health again.
# Prints the runtime, the interfaces, each start's outcome and any network-related log lines.
# Exit 11/12: the first/second start failed.
set -uo pipefail
: "${KEY:?the API server key for this run}"
env_file=/home/hermes/.hermes/profiles/igor/.env
install -m 600 -o hermes -g hermes /dev/null "$env_file"
printf 'OPENROUTER_API_KEY=offline-placeholder\nAPI_SERVER_ENABLED=true\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT=8642\nAPI_SERVER_KEY=%s\n' "$KEY" > "$env_file"
H=(setpriv --reuid=hermes --regid=hermes --init-groups env HOME=/home/hermes USER=hermes LOGNAME=hermes)
echo "interfaces: $(ls /sys/class/net | tr '\n' ' ')"
if curl -s -m 5 -o /dev/null https://pypi.org/ 2>/dev/null; then echo "NETWORK_REACHABLE"; fi

start() {
  "${H[@]}" bash -lc 'cd ~/hermes-agent && source ./activate >/dev/null 2>&1 && exec hermes -p igor gateway run' >"/tmp/gateway-$1.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 180); do
    if curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/health 2>/dev/null; then echo "START_$1=ok after $SECONDS s"; return 0; fi
    kill -0 "$pid" 2>/dev/null || { echo "START_$1=exited"; tail -n 12 "/tmp/gateway-$1.log" | sed 's/^/  log: /'; return 1; }
    sleep 1
  done
  echo "START_$1=timeout"; tail -n 12 "/tmp/gateway-$1.log" | sed 's/^/  log: /'; return 1
}
stop() {
  kill -TERM "$pid"
  for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || { echo "STOP=clean"; return 0; }; sleep 1; done
  echo "STOP=timeout"; kill -KILL "$pid"
}

echo "RUNTIME=$("${H[@]}" bash -lc 'cd ~/hermes-agent && git rev-parse HEAD')"
SECONDS=0; start first || exit 11
stop
SECONDS=0; start second || exit 12
stop
grep -hiE 'github\.com|pypi|resolv|download|network is unreachable|temporary failure in name resolution' /tmp/gateway-*.log \
  | sed -E 's/[0-9a-f]{12,}/<id>/g' | sort | uniq -c | head -5 | sed 's/^/  net-log: /'
exit 0
