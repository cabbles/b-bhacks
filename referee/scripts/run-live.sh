#!/bin/bash
# Run the live referee on this laptop: referee + ngrok tunnel, each restarted if it dies,
# and the Mac kept awake while this runs. Survives closing the terminal or Claude session:
#   nohup referee/scripts/run-live.sh > /dev/null 2>&1 &
# Stop:  referee/scripts/stop-live.sh
# Restart only the referee (e.g. after setting POOL_ADDRESS in .env):  pkill -f "tsx src/index.ts"
# Logs:  referee/logs/referee.log, referee/logs/ngrok.log
set -u
cd "$(dirname "$0")/.."
mkdir -p logs
NGROK_URL="${NGROK_URL:-$(grep -E '^NGROK_URL=' .env 2>/dev/null | cut -d= -f2-)}"

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
loop referee npx tsx src/index.ts &
if [ -n "$NGROK_URL" ]; then
    loop ngrok ngrok http 8787 --url="$NGROK_URL" --log=stdout &
fi
wait
