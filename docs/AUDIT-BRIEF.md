# BlackBox Arena — External Audit Brief (pre-mainnet)

**Date:** 2026-08-26 · **Freeze commit:** `956126c` (docs-only; contracts at same sha as `f7d6d9e`/`c152df1`) · **Class hash (Sepolia B1):** `0x7ca7cd…10e360`
**Toolchain:** Scarb 2.17.0 / Cairo 2.17.0 / snforge 0.59.0 / Sierra 1.8.0 · **Build:** `scarb build` 0 errors (only E2066 LegacyMap deprecation in adapter_v2), `npm run verify` 40/40, secret scan PASS

## What to review

1. `contracts/src/arena.cairo` — round lifecycle (REGISTRATION→LIVE→CLOSED→SETTLED), Option B attested float (`set_float_token` sponsor-once before start, `balance_of` at registration, `checkpoint` permissionless with `poseidon_hash_span([commitment,count])` key, `get_score` `effective_peak = max(start,peak,current)` then `drawdown = 10000 - (start*10000)/peak` semantics, `get_score` branch on `float_token != 0` vs legacy `open_submit_action` path), prize custody, close/settle/withdraw.
2. `contracts/src/arena_adapter_v2.cairo` — per-pool `LegacyMap<(pool,commitment), custody>` (amount+asset), `execute` that records custody + calls arena, `withdraw` permissionless after settlement, E2066 warn is cosmetic (LegacyMap vs Map).
3. `contracts/src/arena_adapter.cairo` (legacy, still deployed in v5 evidence) and mocks.

Tests: `contracts/tests/arena_test.cairo` (53+ P1), `contracts/tests/fuzz_adversarial.cairo` (new 16: saturating bps, checkpoint spam, spoof, branching), `adapter_v2_test.cairo`. Total `snforge test` **92 passed / 0 failed** (seed 9431325249556317828, log `/tmp/snforge-2026-08-26.log` + CI artifact). Fuzzer coverage: `test_fuzz_saturating_bps_never_panics` 128 runs, `test_fuzz_zero_start_guard` 64 runs, `test_fuzz_allocation_cap_enforced` 32, `test_legacy_fuzz_after_values_respected` 32, plus deterministic spoof/branch/spam tests.

## Deployed evidence to cross-check

Sepolia B1 honest round: Arena `0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51`, Adapter `0x42cfafc785c1abeb076c34bcad1e1f698a4e9cf8488a8fbb0ae783acec18c20`, USD mock float `0x02d50cf5…b386`, 13-step evidence `.local/open-round-evidence.b1.json` + independent verifier `scripts/open-round-crosscheck-b1.mjs` (33/33 checks, poseidon re-derive, live `balance_of`, spoof 5000 ignored). Dashboard public-RPC `https://blackbox-arena.vercel.app/?network=sepolia` via `https://starknet-sepolia-rpc.publicnode.com` (no Alchemy key in bundle) shows same live reads: `float_token`, `attest 1000/1000`, `peak/maxDD 1000/200/50`, checkpoints 980/995, scores −200/−50 signed PRIME `(1<<251)+17*(1<<192)+1`, winner Falcon `0x3a01…` settlement 100.

## Threat model — what Option B solves and what it does NOT

**Solved:** `open_submit_action` inflation (arbitrary `portfolio_value_after`) is ignored when `float_token != 0` — B1 proves spoof 5000 has no effect on `get_score`; checkpoint DoS is bounded (poseidon key, gas metered).

**Trust holes still present (disclosed in README/ARCHITECTURE, unchanged by freeze):**

* **Single float token:** one mock USD. A real market token with transfer hooks / rebasing / fees is not modelled. Mainnet needs a vetted token list or per-round token config.
* **Off-float wealth exists:** competitors' wealth outside float token is unmeasured; ranking is float-only, not holistic.
* **Adapter custodial:** each pool escrows prize custody in adapter; compromise of adapter operator = prize loss. No timelock/multisig yet. `close`/`settle` are permissionless but custody stays in adapter.
* **No oracle:** prices are checkpointed floats supplied off-chain; frontend trust is in the operator that calls `checkpoint`. Attested does not mean oracle-verified.
* **Adapter LegacyMap:** deprecated API; not a bug but should migrate to `Map` before mainnet to avoid future Scarb breakage.

## What auditors should focus

* `checkpoint` access control (anyone can call but only registered commitments; ordering of `count` vs `commitment` hash; value == 0 vs maxDD == 0 semantics).
* `set_float_token` one-shot sponsor gate and `get_score` branching — ensure legacy path cannot be forced after float is set.
* `get_score` arithmetic: saturating paths, zero-start guard (−10000), `u128::MAX` → `i64` saturation, integer division truncation.
* Reentrancy in `settle`/`withdraw` (state before external `transfer`), duplicate receipt replay, action-before-start / after-close.
* `VITE` / secret hygiene: deployed `dist/web` must contain no Alchemy key (scan passes; only publicnode hint).

## How to verify locally

```
sha256sum contracts/src/*.cairo contracts/Scarb.toml   # compare to .verification/contracts-freeze-2026-08-26.sha256
~/.local/scarb-gnu/scarb test                           # expect 92 passed
npm run verify                                          # expect 40/40
~/.local/scarb-gnu/scarb build                          # expect 0 errors
node scripts/open-round-crosscheck-b1.mjs               # expect 33/33 against publicnode
```

## Invariants / gates

* No mainnet value without Kyami explicit approval (RED).
* No secret leaks (publicnode only in `dist/web`).
* Every on-chain claim re-derived from live RPC (crosscheck, not log-only).

## Deliverable

Auditor returns findings against commit `956126c` with freeze manifest above; any contract change invalidates the freeze and requires new `sha256sum` + re-run of 92/40/verifiers.
