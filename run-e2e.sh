#!/usr/bin/env bash
set -e
export PATH=/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin:/home/kyami/.nvm/versions/node/v24.19.0/bin:/home/kyami/.cargo/bin:/home/kyami/.local/bin:/home/kyami/.asdf/shims:/usr/bin:/bin

LOG=/mnt/c/Users/USER/Documents/ChatGPT/BlackBox\ Arena/e2e-test.log
echo "[$(date -u +%T)] Starting Blackbox Arena E2E test" > "$LOG"
cd /mnt/c/Users/USER/Documents/ChatGPT/BlackBox\ Arena/_research/starknet-privacy/e2e

npx vitest run --reporter=verbose tests/devnet/blackbox-arena.test.ts >> "$LOG" 2>&1
echo "[$(date -u +%T)] Exit code: $?" >> "$LOG"
