# HANDOFF — Next Task: External audit + mainnet ops (pre-flight, RED)

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — tail “Fuzz + snforge + freeze VERIFIED” (2026-08-26) — 92/92 green, frozen for audit
3. `docs/AUDIT-BRIEF.md` — scope + freeze commit + trust holes + how to verify
4. `.verification/contracts-freeze-2026-08-26.sha256` — sha256 of every Cairo source at audit freeze
5. `docs/ARCHITECTURE.md` — Option B attested float + public RPC flow

## Context
**Vercel LIVE** `https://blackbox-arena.vercel.app/?network=sepolia` (prj_gunz…, dpl_SRo7…Xo READY, publicnode, no key).
**B1 honest round VERIFIED** Sepolia `0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51` / `0x42cfaf…18c20` class `0x7ca7cd…10e360`, 33-check crosscheck, spoof 5000 ignored.
**Fuzz + snforge VERIFIED 2026-08-26:** `contracts/tests/fuzz_adversarial.cairo` 16 tests (saturating bps fuzz 128 runs, zero-start 64, alloc-cap 32, legacy fuzz 32, plus checkpoint spam 20 + poseidon uniqueness, spoof 10×, escrow isolation, peak branch) → `~/.local/scarb-gnu/scarb test` **92 passed / 0 failed** (seed 9431325249556317828, log `/tmp/snforge-2026-08-26.log`), `npm run verify` 40/40, `scarb build` 0. Contracts frozen at HEAD `956126c` (manifest `.verification/contracts-freeze-2026-08-26.sha256`); any edit invalidates freeze.

## Next task — send to audit, then mainnet pre-flight (no chain spend until RED)

1. **External audit (no code change):** send `docs/AUDIT-BRIEF.md` + freeze manifest + `docs/STATUS.md` B1 section + `.local/open-round-evidence.b1.json` to reviewers. Collect findings; do NOT edit `contracts/src/*` until findings are triaged — freeze is the audited code.
2. **If findings require a fix:** patch contracts, bump freeze manifest (`sha256sum contracts/src/*.cairo contracts/Scarb.toml > .verification/contracts-freeze-YYYY-MM-DD.sha256`), re-run `~/.local/scarb-gnu/scarb test` (expect 92+ PASS) + `npm run verify` 40/40 + `scarb build` 0 + both crosschecks, and note the new commit in `docs/STATUS.md`.
3. **Ops pre-flight (RED — needs Kyami explicit approval, do NOT spend):** funded mainnet sponsor wallet, fee budget (~40 STRK declare + 10 STRK round + Already-Declared tolerance), `getClass` preflight for `0x7ca7cd…10e360` (may already be declared), monitoring. Plan only, no tx.

## Proof of completion
- Audit brief sent — reviewer ack recorded in `docs/STATUS.md` or issue tracker.
- Freeze manifest `sha256sum contracts/src/*.cairo contracts/Scarb.toml` matches HEAD on the audited commit; `~/.local/scarb-gnu/scarb test` 92/92 + `npm run verify` 40/40 + crosschecks green on same commit.
- No mainnet tx without approval; `dist/web` still has no secret (scan PASS).

## Invariants
- No mainnet value without Kyami approval (RED).
- Freeze means freeze — any `contracts/src/*.cairo` edit requires new manifest + re-verify.
- Every on-chain claim re-derived from live RPC (crosscheck re-derives, never log-only); receipt + event per write when chain involved.
