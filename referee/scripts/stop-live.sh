#!/bin/bash
# Stop everything run-live.sh started. To only restart the referee (e.g. after editing .env),
# run: pkill -f "tsx src/index.ts"   and the restart loop brings it back in 3s.
pkill -f run-live.sh
pkill -f "tsx src/index.ts"
pkill -f "ngrok http 8787"
echo stopped
