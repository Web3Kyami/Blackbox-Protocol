# HANDOFF — Next Task: Fuzz + snforge VPS + external audit pre-mainnet

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — tail “Vercel deployment LIVE” (2026-08-26) + “Dashboard public-RPC VERIFIED” + “Honest round B1 VERIFIED”
3. `docs/ARCHITECTURE.md` — Option B attested float + public RPC flow + adapter per-pool custody
4. `docs/VALUE-AXIS-OPTIONS.md` + `.verification/option-b-attested-float.req.md` (R1-R10) + `.local/open-round-evidence.b1.json`

## Context
**Sepolia B1 honest round VERIFIED** (arena `0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51`, adapter `0x42cfaf…18c20`, class `0x7ca7cd…10e360`) with full receipt+event chain verification, 33-check independent crosscheck (poseidon rederive, live `balance_of`, spoof 5000 ignored), 40/40 verify, scarb 0.
**Dashboard public-RPC DONE** — `apps/web` reads Sepolia live via `https://starknet-sepolia-rpc.publicnode.com` (no Alchemy key), `?network=sepolia` B1 demo, signed scores, attested panel.
**Vercel LIVE** 2026-08-26: `https://blackbox-arena.vercel.app/?network=sepolia` (project `blackbox-arena` prj_gunzV65…, deployment dpl_SRo7…Xo READY 120.8KB, aliased). Curl + local 4175 + direct publicnode confirms B1 view; `?network=sepolia` shows Falcon LEADER −50, attested 1000/1000/200/50, float_token 0x02d50cf… Judges can verify without `127.0.0.1:4174`.

## Next task — Adversarial hardening before mainnet (no chain spend)

1. **VPS snforge:** run `snforge test` on a host where `dlopen` works (container blocks dynamic libs). Expect **67 tests green** (53 P1 + 14 B). Capture full log, record commit + toolchain (`Scarb 2.17.0`, `snforge 0.59.0`). If any red, fix `arena.cairo`/`arena_test.cairo` and re-`npm run verify` (40/40) + `scarb build` 0.
2. **Fuzz / adversarial suite (new, no deploy):**
   - Saturating bps: `u128::MAX` → `i64::MAX` via `portfolio_return_bps`, zero-start → −10000, peak/current extremes, maxDD overflow paths in `checkpoint`/`get_score`.
   - `checkpoint` spam: many indices per commitment, poseidon key collisions, unregistered/no-float/after-close reverts, repeated `set_float_token` / after-start / double-set / zero-address reverts, high!=0 saturate → `2^128−1`.
   - Spoof variants: repeat B1 spoof with `open_submit_action` inflated `portfolio_value_after` and also `escrowed` amount mismatches; assert `get_score` unchanged and `get_custody` isolates per pool.
   - `open_submit_action` vs attested branch: when `float_token != 0` scorer must ignore argued after-values; when `0` legacy path still correct.
3. **External audit prep:** freeze `contracts/src/arena.cairo` + `contracts/src/adapter.cairo`, produce audit brief with B1 evidence, crosscheck scripts, and trust holes (single float token, off-float wealth, adapter custodial, no oracle) — docs already disclose in README/ARCHITECTURE; collect reviewer queue.
4. **Ops (RED — needs Kyami explicit approval, do NOT spend):** mainnet sponsor wallet funding + signer config + fee budget (≈40 STRK declare + 10 STRK round + Class Hash Already Declared tolerance) + monitoring — plan only, no tx.

## Proof of completion
- VPS `snforge test | cat` log attached with 67 PASS, `npm run verify` 40/40 + `scarb build` 0 on same commit; fuzz suite added under `contracts/tests/` or `scripts/` with at least saturating + checkpoint-spam + spoof-ignored assertions.
- `docs/STATUS.md` appended “Fuzz + audit VERIFIED” with evidence refs; HANDOFF rewritten for mainnet funding or code-freeze.
- No mainnet spend without approval; secrets still PASS.

## Invariants
- No mainnet value without Kyami approval (RED).
- No secret leaks (Alchemy key never in `dist/web`; publicnode only).
- Every on-chain claim re-derived from live RPC (crosscheck re-derives, never log-only); receipt + event per write when chain involved.
