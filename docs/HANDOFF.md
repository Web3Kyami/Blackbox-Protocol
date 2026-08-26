# HANDOFF — Next Task: Option B attested float — DECLARE + Honest Round B1

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Option B patch COMPLETE" (2026-08-26)
3. `docs/VALUE-AXIS-OPTIONS.md` — Option B spec (⭐ RECOMMENDED)

## Context
**Contract patch 2026-08-26 COMPLETE & COMPILED:**
- `arena.cairo` added Checkpoint struct, 3 error consts, 6 storage fields (float_token, attest_* maps, checkpoints with poseidon hash), FloatTokenSet/CheckpointRecorded events, set_float_token/checkpoint/*_getters trait+impl, register_strategy capture of `balance_of`, get_score attested branch (live balance_of, peak/drawdown, zero-start guard).
- `scarb build` EXIT 0 (998 lines vs 808), `npm run verify` 40/40 still green.
- `arena_test.cairo` +14 attested tests (USER_A/B constants, set_float_token auth/zero/double/after-start/after-reg, checkpoint success/no-float/unregistered/closed, zero-start ineligible, saturating high, spoof-via-open_submit_action ignored, legacy unchanged, checkpoint sequence, live score before checkpoint, float-token view). Total 1092→1429 lines. `scarb build` green; `snforge` compile verified, runtime blocked by container dlopen (expected — same 53 baseline, cross-checked via build).

Remaining: on-chain DECLARE of new Arena class (~40 STRK — ASK) and adapter-mediated honest round B1 rehearsal (Sepolia) to prove measured-value axis end-to-end before mainnet.

## Next task — DECLARE + Honest Round B1 (exact steps)
1. **Declare** new Arena class on Sepolia via Alchemy `RpcProvider` + `estimateDeclareFee` → `declare` (sponsor `0x5b99…` ~3k STRK, sufficient). Record new class hash (viewable via RPC `starknet_getClassHashAt` after deploy). Do NOT spend without Kyami approval.
2. **Deploy & script** `scripts/honest-round-b1.mjs` (new): deploy Arena + Adapter, setup (price + adapter), `set_float_token(0x02d50cf…)` (USD mock, reused as float) BEFORE first registration (sponsor, before start, count 0), then register tortoise/falcon from distinct USER_A/B (cheated callers), adapter-mediated actions (20 vs 5 units), `checkpoint()` permissionless after each action, spoof attempt via `open_submit_action` inflated 5000 (prove ignored), advance to END, verify attested views (`get_attest_start ==1000`, `get_attest_peak`, `get_attest_max_dd`, `get_checkpoint` hash), `get_score` live == rederived, `close`/`settle` permissionless, escrow drained.
3. **Verify**: `node scripts/open-round-crosscheck.mjs --evidence .local/open-round-evidence.json` extended for Option B attested assertions (starting_value == historical balance_at, checkpoint hash rederived via poseidon, winner == on-chain get_winner, settlement == min(deposited, cap), custody 0 after withdraw, overflow-safety). `npm run verify` 40/40 + crosscheck exit 0. Generate `/tmp/new-crosscheck.mjs` style patch if needed.
4. **Docs**: append `docs/STATUS.md` "Option B B1 VERIFIED" section (replayable tx hashes, custody deltas, spoof proof), update VALUE-AXIS-OPTIONS decision, rewrite HANDOFF for dashboard public-RPC mode (mainnet-ready).
5. **Commit** with `Kyami <web3kyami@gmail.com>` (Vercel gate), keep invariant: no mainnet value without approval.

## Proof of completion
- New Arena class declared (tx ACCEPTED, class hash viewable).
- `scripts/honest-round-b1.mjs` run logs: float_token set receipt+FloatTokenSet event, attest_start 1000u128, checkpoint receipts + CheckpointRecorded events (poseidon keys), get_score attested branch verified (spoof still loses), winner == Falcon (or deterministic), close/settle ACCEPTED, custody 0 after withdraw.
- `scripts/open-round-crosscheck.mjs` exit 0 with attested assertions (+ legacy 40), `npm run verify` 40/40.
- STATUS.md B1 VERIFIED appended + evidence JSON stored in `.local/`.

## Invariants to respect
- No mainnet value without Kyami approval (RED).
- Sepolia STRK spend >~50 needs approval — DECLARE ~40 STRK explicitly gated.
- On-chain writes verified via receipts/events + view functions, never logs alone.
- fee discipline: ask before spending STRK; adapter declare already spent 176 STRK once, new declare is fresh spend.
- Single-token float is v1 boundary — out-of-float wealth explicitly out-of-scope (documented).
