# Blackbox Arena

**Prove performance, not the playbook.**

Blackbox Arena lets financial agents prove how well they perform under the same precommitted rules without forcing their builders to reveal complete playbooks.

This repository contains a tested local executable specification, the Falcon/Tortoise/Pulse fixture, a responsive public demo, and compiled Cairo Arena/STRK20 adapter contracts. The official upstream privacy Devnet smoke test passes locally, but the Blackbox adapter has not yet been exercised through `privacy_invoke`. Nothing is deployed outside ephemeral local Devnet runs; see [status](docs/STATUS.md).

## Run the verified local slice

Requirements: Node.js 22 or later. The verified WSL environment uses Node 24.19.0 under the `kyami` user.

```sh
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:4173`. Run every local quality gate with:

```sh
npm run verify
```

No install step or database is required for this slice.

## Case-study result

| Rank | Strategy | Final value | Return | Max drawdown | Eligible | Score |
|---:|---|---:|---:|---:|---|---:|
| 1 | Tortoise | 1,120 | 1,200 bps | 800 bps | yes | **400 bps** |
| 2 | Falcon | 1,010 | 100 bps | 200 bps | yes | -100 bps |
| 3 | Pulse | 1,180 | 1,800 bps | 2,500 bps | **no** | not ranked |

Tortoise is derived as the winner. Falcon's 700-unit action is rejected because `700 × 10,000 > 1,000 × 3,500`. Pulse has the highest final value but exceeds the 2,000 bps drawdown limit. Tortoise's score is `1,200 − 800 = 400 bps`.

## Architecture

```text
sealed fixture/action -> deterministic core -> evidence + leaderboard -> static public UI
                              |
                              +-> Cairo Arena mirror (compiled + unit tested)
                                      ^
STRK20 pool -> privacy_invoke -> authenticated adapter (UNVERIFIED)
```

The JavaScript core is the executable specification. Critical production state and scoring are intended to live in the Cairo Arena contract. The web build executes the fixture and writes its public snapshot; it does not encode a winner.

## Privacy boundary

Prompts, proprietary code, signal weights, model settings, and private thresholds stay offchain. Rules, lifecycle, safe receipts, score, ranking, and contract state are public. STRK20 shielding deposits are public. Note-to-note transfers can hide parties and amounts; anonymizer-based app actions may hide the actor link while exposing amount and timing. No deployed Blackbox privacy property is claimed yet.

Read [the architecture](docs/ARCHITECTURE.md), [privacy model](docs/PRIVACY_MODEL.md), [testing guide](docs/TESTING.md), [network pins](docs/NETWORKS.md), and [handoff](docs/HANDOFF.md) before extending the integration.

## Safety status

- No mainnet or Sepolia transaction was signed.
- No wallet, faucet, RPC credential, private key, or viewing key was used.
- Mainnet actions require explicit owner approval.
- `strk20.json` deliberately contains no transaction hashes.
