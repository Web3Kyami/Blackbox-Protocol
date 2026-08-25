# HANDOFF — Next Task: honest round v5 on the fixed class (declare + adapter-mediated)

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Codex external review + Pile-1 fixes" section
3. `docs/REVIEWS/codex-2026-08-25.md` — the independent review driving this

## Context
Pile-1 contract defects from the codex review are FIXED in source (commit 06580da):
panic-free saturating scoring, `max_strategies` registration cap, CEI settle,
rules freeze. 53/53 tests green. The fixes exist only as source — no new class
has been declared on Sepolia yet.

## Next task (exact steps)
1. Declare the fixed Arena class on Sepolia (~40 STRK — ASK KYAMI BEFORE SPENDING).
   Record the new class hash in STATUS.md.
2. Run an **adapter-mediated** honest round v5 against it (`scripts/honest-round.mjs`
   already passes `max_strategies=64`): trades must flow through the action adapter,
   not raw transfers to a sink — this closes codex's "dummy sink" criticism of v4.
3. Extend `scripts/open-round-crosscheck.mjs`: assert winner/refund/prize math AND
   that every action's execution evidence is adapter-emitted, plus overflow-safety
   spot checks (submit u128::MAX portfolio value pre-close; round must still close).
4. Update STATUS.md with v5 results; rewrite this file for the next task.

## Proof of completion
- New class hash declared (view call: `core::starknet::class_hash::get_contract_class_hash` equivalent via RPC).
- Round v5 settled; crosscheck exit 0 with adapter-evidence assertions.
- Every write confirmed per-tx by receipt + event parsing (never logs alone).

## Invariants to respect
- No mainnet value movement without Kyami's explicit approval (RED).
- Sepolia STRK spend >~50 needs approval first.
- On-chain writes verified via receipts/events + view functions, never logs alone.
