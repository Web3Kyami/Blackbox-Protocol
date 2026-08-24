#!/usr/bin/env bash
set -e
REPO_ROOT="/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena"
export PATH="/home/kyami/.asdf/installs/scarb/2.17.0/bin:/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin:/home/kyami/.nvm/versions/node/v24.19.0/bin:/home/kyami/.cargo/bin:/home/kyami/.local/bin:/usr/bin:/bin"
cd "$REPO_ROOT/_research/starknet-privacy/e2e"
npx --no-install vitest run --config ../../../packages/devnet-session/vitest.config.ts test/blackbox-arena.test.ts --reporter=verbose --testTimeout=120000 --hookTimeout=120000
