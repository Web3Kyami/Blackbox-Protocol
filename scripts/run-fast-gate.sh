#!/usr/bin/env bash
# Fast local gate: format/lint/typecheck/28 unit tests/web build/secret scan.
set -e
cd "$(dirname "$0")"
export PATH="/home/kyami/.nvm/versions/node/v24.19.0/bin:/home/kyami/.asdf/shims:/home/kyami/.local/bin:/usr/bin:/bin"
echo "== Node $(node --version) | npm $(npm --version) =="
npm run verify
