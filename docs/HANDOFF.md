# HANDOFF — Next Task: Option B attested float (contract-measured value axis)

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Honest round v5" section (newly verified)
3. `docs/VALUE-AXIS-OPTIONS.md` — Option B spec (⭐ RECOMMENDED)

## Context
Honest round v5 is VERIFIED on Sepolia (Arena `0x520fe266…`, Adapter `0x4b9c57d1…`, BOTH actions adapter-mediated, close/settle permissionless, escrow drained, custody per-pool, crosscheck exit 0 with adapter-emissions + overflow-safety, `npm run verify` 40/40). P1 fixes are now DECLAREd (Arena class `0x6dac5b…`, Adapter `0x418dbc…`).

Remaining central hole: winner scoring still uses **strategy-reported** `current_value` (D012). Option B closes it by making the Arena **measure** the float itself via `token.balance_of(registrant)` at register (store `starting_value`) and at close (read `final_value`), with permissionless `checkpoint()` for intra-round drawdown.

## Next task — Implement Option B (exact steps)
1. **Contract** `contracts/src/arena.cairo`:
   - Store float token at `setup()` (lock post-start like price/adapter).
   - At `register_strategy`: read `balance_of(registrant)` → store as `starting_value` per commitment (no caller-provided starting_units).
   - Add `checkpoint(commitment)` permissionless: snapshot `balance_of` with timestamp, append to per-strategy checkpoint log; enforce monotone or just record.
   - Replace `current_value` scoring input: `get_score` / `close` / `settle` derive `(final - start)/start` and drawdown from stored checkpoints + final read. Keep saturating u256 bps logic.
   - Keep escrowed action bonds + permissionless lifecycle intact. Add `NotSingleFloat` or reuse existing guards if needed.

2. **Tests** `contracts/tests/*`:
   - Register stores starting_value == live balance (mock token with known supply).
   - Checkpoint appends, drawdown computed from peak-to-trough over checkpoints + final.
   - Close/settle derive winner from measured values; self-reported spoof attempt cannot win.
   - Saturating still holds (u128::MAX final), registration cap + CEI still green.
   - Expect ≥10 new tests; full suite 53+ → ≥63 green via `~/.local/scarb-gnu` + `snforge 0.59.0`.

3. **Scripts** `scripts/honest-round*.mjs` + `scripts/open-round-crosscheck.mjs`:
   - Honest round B1 simplifies: no self-reported value derivation — just balance reads; crosscheck verifies starting_value == on-chain stored vs block-historical balance_at.
   - Add negative test: register then inflate reported value off-chain — assert measured winner unchanged.

4. **Declare on Sepolia (~40 STRK — ASK KYAMI BEFORE SPENDING)** + run honest round B1 against it (adapter flow unchanged).

5. **Docs**: update `docs/STATUS.md` with B1 results, update `VALUE-AXIS-OPTIONS.md` decision line, regenerate HANDOFF for dashboard public-RPC.

## Proof of completion
- `cargo test` / `snforge` ≥63 tests green (new B tests passing, no regressions).
- New class hash declared (RPC view) + honest round B1 evidence VERIFIED + crosscheck exit 0 with measured-value assertions.
- Every write receipt+event verified, sponsor never pays less than `min(deposited, cap)`, adapter-mediated custody unchanged.
- `npm run verify` 40/40 (frontend adapted to no self-report input).

## Invariants to respect
- No mainnet value without Kyami approval (RED).
- Sepolia STRK spend >~50 needs approval first.
- On-chain writes verified via receipts/events + view functions, never logs alone.
- Single-token float is the v1 boundary — out-of-float wealth explicitly out-of-scope (documented).
