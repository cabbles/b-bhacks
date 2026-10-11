#!/usr/bin/env bash
# Windows/Linux host for the web app (web/scripts/run-live.sh is the macOS version).
# Builds once, then keeps `next start` up. URLs come from shared/deployments.json.
cd "$(dirname "$0")/../web"
PORT="${PORT:-3000}"
npx next build >> web.log 2>&1 || { echo "build failed, see web/web.log"; exit 1; }
while true; do
  echo "[$(date -u +%T)] starting web" >> web.log
  npx next start -p "$PORT" >> web.log 2>&1
  echo "[$(date -u +%T)] web exited ($?), restarting in 3s" >> web.log
  sleep 3
done
