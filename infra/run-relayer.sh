#!/usr/bin/env bash
# Keeps the relayer up on the host laptop: restarts it if it exits. Logs to relayer/relayer.log.
# The public URL comes from a separate tunnel process (see infra/README.md), so restarts keep the URL.
cd "$(dirname "$0")/../relayer"
while true; do
  echo "[$(date -u +%T)] starting relayer" >> relayer.log
  npx tsx src/index.ts >> relayer.log 2>&1
  echo "[$(date -u +%T)] relayer exited ($?), restarting in 2s" >> relayer.log
  sleep 2
done
