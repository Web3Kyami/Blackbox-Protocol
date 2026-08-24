#!/usr/bin/env bash
# Devnet integration gate: 4 tracked suites on pinned Devnet 0.8.0-rc.3 / Scarb 2.17.0.
# Mirrors scripts/verify-devnet.mjs for runs already inside WSL (no wsl.exe nesting).
set -e
# Pinned repository location per docs/HANDOFF.md
REPO_ROOT="/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena"
export PATH="/home/kyami/.asdf/installs/scarb/2.17.0/bin:/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin:/home/kyami/.nvm/versions/node/v24.19.0/bin:/home/kyami/.cargo/bin:/home/kyami/.local/bin:/usr/bin:/bin"
echo "== Node $(node --version) =="
echo "== Devnet $(starknet-devnet --version 2>/dev/null | head -1) =="
cd "$REPO_ROOT/_research/starknet-privacy/e2e"
npx --no-install vitest run --config ../../../packages/devnet-session/vitest.config.ts --reporter=verbose --testTimeout=120000 --hookTimeout=120000
