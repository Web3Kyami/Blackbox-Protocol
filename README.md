# Blackbox Arena

**Prove performance, not the playbook.**

Blackbox Arena lets financial agents prove how well they perform under the same precommitted rules without forcing their builders to reveal complete playbooks. This repository contains a tested executable spec, Cairo Arena + adapter contracts, and two verified judges-visible demos.

## Live — Sepolia B1 honest round (public RPC, no secrets)

**Demo:** [`https://blackbox-arena.vercel.app/?network=sepolia`](https://blackbox-arena.vercel.app/?network=sepolia)

Also works explicitly: `?network=sepolia&arena=0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51&rpcUrl=https://starknet-sepolia-rpc.publicnode.com`

- Reads **B1 arena `0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51`** directly via `https://starknet-sepolia-rpc.publicnode.com` — no Alchemy key, no `127.0.0.1:4174` hardwire, no env secrets (mainnet-ready public RPC mode).
- Panel shows **Option B attested float**: `float_token 0x02d50cf5…b386`, attest `start 1000 / peak 1000 / maxDD 200 vs 50`, checkpoint poseidon `980/995`, scores `-200 vs -50`, winner **Falcon −50 LEADER**, settlement `100`.
- Proof that spoofing fails: Tortoise `open_submit_action` inflated `5000` is ACCEPTED on-chain but ignored by `get_score`; winner stays Falcon.
- Wallet tab → “Join with your own wallet” works over public RPC (no devnet).

**Network pins (B1, Sepolia):**

| Entity | Address / Hash | Voyager (sepolia) |
|---|---|---|
| Arena (B1) | `0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51` | [contract](https://sepolia.voyager.online/contract/0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51) |
| Adapter | `0x42cfafc785c1abeb076c34bcad1e1f698a4e9cf8488a8fbb0ae783acec18c20` | [contract](https://sepolia.voyager.online/contract/0x42cfafc785c1abeb076c34bcad1e1f698a4e9cf8488a8fbb0ae783acec18c20) |
| Float token (USD mock) | `0x02d50cf1955c48a1089ae0be3a9d78733e79e667778650277a50945e9818b386` | [contract](https://sepolia.voyager.online/contract/0x02d50cf1955c48a1089ae0be3a9d78733e79e667778650277a50945e9818b386) |
| Arena class | `0x7ca7cd737a3336ff135a53d171feadd78cf36a52b31c93dca14a02f9310e360` | — |
| Setup tx | `0x350358cf03b93f4679e3c55bdc0370e12c2598ba718089f4ea40743cfe62da2` | [tx](https://sepolia.voyager.online/tx/0x350358cf03b93f4679e3c55bdc0370e12c2598ba718089f4ea40743cfe62da2) |
| Tortoise action (20 units) | `0x42a2c80a390c27596e07ca9c730b27721ab206851bde7548f0012c1e12e010b` | [tx](https://sepolia.voyager.online/tx/0x42a2c80a390c27596e07ca9c730b27721ab206851bde7548f0012c1e12e010b) |
| Falcon action (5 units) | `0x65fa868968547f185e640ac3b29f8356b281fedc6f9cecf08cf60669334e529` | [tx](https://sepolia.voyager.online/tx/0x65fa868968547f185e640ac3b29f8356b281fedc6f9cecf08cf60669334e529) |
| Close (Tortoise, non-sponsor) | `0x39dbbee77f468079df531f7ba9107e56cb92caf2bda298b0e4a7aaeb9a935c` | [tx](https://sepolia.voyager.online/tx/0x39dbbee77f468079df531f7ba9107e56cb92caf2bda298b0e4a7aaeb9a935c) |
| Settle (Falcon, non-sponsor) | `0x4cfaf5327e40bf0749eca9e1af9fe573bf1f6d3b23dbb4cc578fceccb6e4523` | [tx](https://sepolia.voyager.online/tx/0x4cfaf5327e40bf0749eca9e1af9fe573bf1f6d3b23dbb4cc578fceccb6e4523) |
| Rules commitment | `0xd4aed48668e3726badf199601b40b27fa9538c33700bc62c3075babe51f9` | on-chain `rules_commitment()` |

Verification (no trusted logs): every hash is `SUCCEEDED` on-chain; independent re-derive via `scripts/open-round-crosscheck-b1.mjs` (33 checks: poseidon checkpoints, live `balance_of`, spoof ignored, winner/settlement/custody zero, every tx sender/mediation). Also `npm run verify` 40/40.

## Run the verified local slice

Requirements: Node.js 22+, WSL Ubuntu / `kyami` for devnet session.

```sh
npm test
npm run build
npm run dev          # http://127.0.0.1:4173 (fixture demo)
npm run verify       # 40/40 (format/lint/typecheck/40 tests/build/secret)
```

Without `?network=sepolia` the dashboard uses the local devnet session (`127.0.0.1:4174`) and shows “Devnet Active” — same UI, different RPC path. With `?network=sepolia` or `?public=1` it switches to public RPC (no devnet needed, judge-friendly).

Full lifecycle on local devnet: `npm run devnet:session` → `http://127.0.0.1:4173` → register/close/settle controls.

## Case-study result (fixture demo, deterministic)

| Rank | Strategy | Final value | Return | Max drawdown | Eligible | Score |
|---:|---|---:|---:|---:|---|---:|
| 1 | Tortoise | 1,120 | 1,200 bps | 800 bps | yes | **400 bps** |
| 2 | Falcon | 1,010 | 100 bps | 200 bps | yes | -100 bps |
| 3 | Pulse | 1,180 | 1,800 bps | 2,500 bps | **no** | not ranked |

Tortoise wins the fixture. B1 Sepolia live round above uses real token balances and attested float instead of fixture values.

## Architecture

```text
sealed fixture/action -> deterministic core -> evidence + leaderboard -> static public UI
                              |
                              +-> Cairo Arena mirror (compiled 998 lines, tests pending snforge 67)
                                     ^
Option B attested float: token balance_of @ register -> checkpoint() -> get_score(balance_of+peak/maxDD)
STRK20 pool -> privacy_invoke -> ArenaAdapter (per-pool custody, transfer_from) -> Arena.open_submit_action*
  (* legacy; scorer ignores it when float_token set — spoof proof)
Public RPC: starknetCall(rpcUrl, arena, selector, calldata) — no devnet daemon
```

The JavaScript core is the executable spec. The Cairo Arena (`0x7ca7cd…10e360`) is the production authority (Option B). See [architecture](docs/ARCHITECTURE.md) for scoring, checkpoints, and value-axis options.

## Privacy boundary

Prompts, proprietary code, signal weights stay offchain. Rules, lifecycle, receipts, scores, checkpoint poseidon hashes, and contract state are public. Note-to-note transfers could hide parties; app actions expose amount/timing but not strategy. Adapter pool is custodial until STRK20 privacy pool integration.

## Trust assumptions (honest list)

- **Option B attested float:** score reads `balance_of(float_token, registrant)` at register (start) and at `get_score` (final); intra-round peak/drawdown from permissionless `checkpoint()` snapshots. Wealth outside the single float token is invisible — strategies must be float-constrained; unexplained balance jumps are forfeit under contest rules.
- **Off-float wealth, LPs, hedge books:** out-of-scope for single-token float; multi-position funds need an oracle design (see `docs/VALUE-AXIS-OPTIONS.md`).
- **Drawdown completeness:** if nobody calls `checkpoint()` mid-round, only start/end observable — mitigated by permissionless crank + `settle()` checkpoint-count gate (future).
- **Adapter custodial:** allocation is `allocation_units × price` pulled via `transfer_from` into adapter per-pool custody; withdrawn post-settle. STRK20 pool privacy flow not yet wired.
- **Sponsor trust:** sponsor sets rules/commitment/price/float_token before start only; cannot edit post-start.

## Docs map

- [Architecture](docs/ARCHITECTURE.md) — state machine, rules commitment, scoring, adapter, Option B, public RPC.
- [Value-axis options](docs/VALUE-AXIS-OPTIONS.md) — why Option B was chosen.
- [Option B reqs](/.verification/option-b-attested-float.req.md) — R1-R10 frozen.
- [Status / evidence](docs/STATUS.md) — every verified phase, latest is B1 + Vercel.
- [Handoff](docs/HANDOFF.md) — next task (fuzz + external audit or mainnet funding).
- Evidence: `.local/open-round-evidence.b1.json`, `.local/open-round-evidence.json` (v5), crosschecks `scripts/open-round-crosscheck*.mjs`.
