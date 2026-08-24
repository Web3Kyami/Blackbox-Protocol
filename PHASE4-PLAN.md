# Phase 4–7: Pre-Mainnet Product Completion — Implementation Plan

# Phase 4–7: Pre-Mainnet Product Completion — Implementation Plan

**Date:** 2026-08-23
**Status:** PHASE 4 COMPLETE AND VERIFIED — Foundry 38/38; fast gate 28/28 + all steps; `npm run verify:devnet` 4/4 suites in 108.79 s (Stage A deploy/lock, Stage B dashboard + registrants, Stage C lifecycle incl. escrowed prize payout with exact winner balance delta, E2E privacy pipeline). Includes a latent adapter price-conversion bug fix (`allocation × price`, not `allocation × 10¹⁸ ÷ price`) surfaced by the rebuilt artifacts. Next: Phase 5 (wallet integration + self-service participation). Gate runners added: `scripts/run-fast-gate.sh`, `scripts/run-devnet-gate.sh`.

Sequencing rule: contract changes (Phase 4) land before session/UI work (Phases 5–6) so the ABI stabilizes once. Each numbered item ends with its gate run and a `docs/STATUS.md` update before the next begins.

---

## Phase 4 — Contract completeness and parity hardening

### P4.1 Foundry parity breadth

The case-study outcome is already verified on-chain mirror (`test_case_study_derives_tortoise_winner`: Falcon −100, Tortoise +400 winner, Pulse ineligible, settle under cap). Remaining gaps against the JavaScript specification (`packages/core/src/arena.mjs`):

New tests:
- Rejected **non-duplicate** receipt is consumed (D003 semantics): same `receipt_id` resubmitted with altered fields returns `DUPLICATE`.
- Action submitted after close returns rejection (not panic) and increments `rejected_actions`.
- Unregistered-commitment action through adapter returns `UNREGISTERED` and consumes the receipt ID.
- Registration exactly at `start_time` panics `REGISTRATION_CLOSED`; one second before succeeds (boundary).
- Registered strategy with zero actions scores starting value / 0 bps / eligible.
- Tie-break breadth: equal score, unequal drawdown; equal score and drawdown, unequal registration order (existing test covers both paths; add equal-score-equal-drawdown-equal-order impossibility guard).

Acceptance: `snforge test` green; `docs/TESTING.md` gains a JS-invariant → Cairo-test mapping table.

### P4.2 Operator binding (registrant identity) — CODE COMPLETE, VERIFICATION PENDING

Prerequisite for paying a prize to a human/agent account (P4.3) and for the self-service flow (Phase 5).

- Add `registrant: ContractAddress` to `StrategyState`; set from `get_caller_address()` in `register_strategy`.
- Emit `StrategyRegistered { commitment, registration_order, registrant }`.
- New view: `get_registrant(commitment) -> ContractAddress`.
- Registration stays permissionless-before-start (that is already the contract truth; only the session layer restricted it).

Tests: registrant recorded correctly; distinct registrants; view returns zero for unknown commitment.

Session sync: `packages/devnet-session/src/blackbox-session.ts` manifest exposes registrant per strategy; Stage B assertion extended.

### P4.3 Settlement token mechanics — CODE COMPLETE, VERIFICATION PENDING

Today `settle()` records winner and amount but moves nothing (`contracts/src/arena.cairo`). Implemented as an honest escrow payout:

- Constructor gains `prize_token: ContractAddress` parameter (non-zero enforced).
- New sponsor-callable `deposit_prize(amount_units)` — pulls the prize token from the sponsor via `transfer_from` after sponsor approval. Emits `PrizeDeposited`; cumulative total exposed by `get_prize_deposited()`.
- `settle(amount_units)` keeps cap/single-use checks, then additionally: requires a non-zero registrant for the winner (`NO_REGISTRANT`), asserts Arena token balance ≥ amount (`NO_PRIZE`), transfers `amount_units` to the winner's registrant, and emits `PrizePaid { winner_commitment, recipient, amount }`. Settlement record unchanged.
- Green-path private payout (unshield through pool to winner note) stays an open decision and is NOT built here; recorded as D013.

New `MockPrizeToken` contract (`contracts/src/mock_prize_token.cairo`) supports Foundry tests; the Devnet session funds escrow with its existing OZ-based TestUSD.

Tests: deposit + settle pays registrant (non-sponsor recipient asserted); settle without funding panics `NO_PRIZE`; over-cap panics (existing); double-settle panics (existing); non-sponsor/zero deposits panic; prize-token view. Case-study test updated to fund the prize before settling.

Session sync: deploy calldata gains prize token; session mints/approves/deposits 100 units at setup; manifest exposes `prizeToken` + `prizeDeposited`; Stage C asserts winner balance delta of exactly 100.

### P4.4 Self-reported after-value: document, do not fake — DONE

`portfolio_value_after` is taken on faith (only `before` is checked against stored state). A static pre-start sponsor price cannot validate intra-round deltas, so no honest on-chain check exists without per-action signed valuations or an oracle.

Action: **D012** recorded in `docs/DECISIONS.md`; trust assumption added to `docs/ARCHITECTURE.md`; UI disclosure required when Phase 6 evidence work lands. No pretend validation code.

---

## Phase 5 — Wallet integration and self-service participation — CORE SHIPPED

1. ✅ Wallet connection in `apps/web` via injected Starknet Wallet API (`window.starknet`) — zero external dependencies; detects Ready (Argent), Braavos, generic.
2. Server-held signer demotion: sponsor/bootstrap operations stay on the session service, explicitly labeled local-devnet-only; operator registration moved off server signers entirely (browser wallet signs directly). Full endpoint deprecation deferred to Phase 6 polish.
3. ✅ Self-service UI: "Join With Your Own Wallet" — commitment validation (felt252 bounds), direct `register_strategy` execution from the connected wallet, and post-tx verification of the on-chain registrant binding via `get_registrant` before success is reported. Registration list shows contract-read registrants per strategy.
4. ✅ Six new pure-function tests (34/34 fast gate); origin allowlist and zero-secret guarantees untouched.

Gate: `npm run verify` green; session API unchanged so `verify:devnet` remains valid from Phase 4.

## Phase 6 — Dashboard evidence completion — SHIPPED

1. ✅ Per-receipt transaction references (hash + block number captured at submission); explorer links network-aware via `explorerTxUrlFor()` — Devnet rows show the bare hash, Sepolia/Mainnet rows link to Voyager once those stages land.
2. ✅ Network labels: `networkLabelFor()` drives `SIMULATED / LOCAL DEVNET / SEPOLIA / MAINNET / OFFLINE` across leaderboard, evidence, footer, and the Case Study tab ("SIMULATED — not a live network" pill).
3. ✅ Evidence view: manifest exposes deploy-time `roundParams`; UI renders canonical key-sorted JSON for local sha256 recomputation against `commitRules()`. "Export Evidence" downloads session receipts as JSON with metadata.
4. ✅ Sponsor controls relabeled "session-administered · local devnet only"; Case Study tab remains behind its explicit simulation labels.

Gate: fast gate 40/40; `npm run verify:devnet` 4/4 suites in 118.02 s.

## Phase 7 — Sepolia dress rehearsal — IN PROGRESS (interrupted for session handoff)

Done:
- ✅ Disposable deployer account deployed & funded (~85 STRK remaining); credentials in `.env.local`
- ✅ RPC solved: Alchemy (D015) — estimation + large bodies work; all free alternatives catalogued as broken
- ✅ Prize token declared + deployed (`0x734ebf9f…849a`); ⚠️ duplicates from partial runs exist — reconcile first
- ✅ Measured real costs: arena declare = 844,860,800 l2_gas (~41 STRK actual); pool ≈ 55 STRK → D014 scoped rehearsal
- ✅ Raw-signed declare technique proven (bypasses lib quirks); scripts: `sepolia-status/probe-estimate/declare-pool/inspect-tx/crosscheck`

Remaining:
1. Refactor `sepolia-deploy-round.mjs`: swap `submitMeasured` guessing for direct Alchemy estimates (`probe-estimate.mjs` proves the path)
2. Reconcile/pin canonical TestUSD in state
3. Execute round: setup multicall → wait end-time → **close/settle script still needs writing** → payout verification
4. Evidence into `strk20.json` contracts field + NETWORKS classification
5. Full gates rerun; STATUS → VERIFIED

Funding note: balance ~85 STRK vs arena-declare worst-case ~61 STRK → top up ≥ 50 STRK via faucet before the run to cover adapter declare + multicall + close/settle comfortably.

---

## Gate summary

| Item | Gate |
|---|---|
| P4.x each | `scarb build` + `snforge test`, then full `npm run verify` |
| P4.3 end | `npm run verify:devnet` 4/4 with payout assertions |
| P4.4 | Docs merged (D012), no code |
| Phase 5 | `verify` + `verify:devnet`, secret scan clean |
| Phase 6 | web build + UI contract tests |
| Phase 7 | Sepolia round evidence recorded |

## Explicitly out of scope

Mainnet deployment/signing; demo video and hub submission packaging; LLM strategy runtime; generalized marketplace; decentralized oracle (deferred by D012); multi-round Arenas.
