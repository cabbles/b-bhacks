#!/bin/bash
# Serve the production web app from this laptop, restarted if it dies, Mac kept awake.
# Same shape as referee/scripts/run-live.sh. From the repo root:
#   nohup web/scripts/run-live.sh > /dev/null 2>&1 &
# Optional public URL:  WEB_TUNNEL=cloudflared  (quick tunnel, URL printed in web/logs/tunnel.log)
#                       WEB_TUNNEL=ngrok NGROK_URL=your-domain.ngrok-free.dev
# Service URLs come from shared/deployments.json; override with NEXT_PUBLIC_* in web/.env.local.
# Logs: web/logs/web.log, web/logs/tunnel.log.  Stop: pkill -f "web/scripts/run-live.sh"; pkill -f "next start -p 3000"
set -u
cd "$(dirname "$0")/.."
mkdir -p logs
PORT="${PORT:-3000}"

echo "[$(date -u +%FT%TZ)] building" >> logs/web.log
npx next build >> logs/web.log 2>&1 || { echo "build failed, see web/logs/web.log"; exit 1; }

loop() { # name, command...
    local name=$1; shift
    while true; do
        echo "[$(date -u +%FT%TZ)] starting $name" >> "logs/$name.log"
        "$@" >> "logs/$name.log" 2>&1
        echo "[$(date -u +%FT%TZ)] $name exited ($?), restarting in 3s" >> "logs/$name.log"
        sleep 3
    done
}

trap 'kill $(jobs -p) 2>/dev/null; exit 0' INT TERM
caffeinate -dis -w $$ &
loop web npx next start -p "$PORT" &
case "${WEB_TUNNEL:-}" in
    cloudflared) loop tunnel cloudflared tunnel --url "http://localhost:$PORT" & ;;
    ngrok) loop tunnel ngrok http "$PORT" --url="${NGROK_URL:?set NGROK_URL}" --log=stdout & ;;
esac
wait
