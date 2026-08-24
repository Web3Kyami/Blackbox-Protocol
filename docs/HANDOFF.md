# HANDOFF — Next Task: value-axis design decision (strategy-reported → enforced)

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Honest round v4" section is current state
3. Skills: `web3/blackbox-arena`, `web3/starknet-sdk-pitfalls`, `web3/onchain-verify-not-logs`
4. `contracts/src/arena.cairo` (scorer + escrow) and `packages/strategy-adapter` semantics

## Context
Sepolia rehearsal is DONE and fully verified: honest round v4 ran end-to-end on
class `0xf170ef4c…b9bd7` with contract-observed escrowed allocations, permissionless
close/settle/refund; crosscheck exit 0 proves three-way agreement
(script claim == chain replay == contract-stored escrow).

The LAST trust hole: **portfolio values are strategy-reported.** Escrowed
allocations are contract-enforced, but `current_value` (which drives scoring via
the adapter path) is still whatever the strategist reports through the adapter.
On mainnet this must not stand — a lying strategist could win a prize.

## Task: pick + spec the enforcement mechanism for the value axis
Compare, decide, and write a one-page design doc (`docs/DESIGN-value-axis.md`)
covering at minimum:
1. **Oracle-fed prices** (Pragma/Chainlink-style feed): Arena reads asset price,
   computes portfolio value from escrowed allocations + reported cash balance.
   Cash balance remains reported unless also escrowed — state residual risk.
2. **Pool-share accounting** (e.g. Vesu/Ekubo shares as the escrowed asset):
   value = shares × pricePerShare read from pool — removes price oracle but adds
   venue risk.
3. **Full custody vault**: all strategy funds live in Arena-owned vault; values
   are pure contract arithmetic — strongest, changes product shape.
Recommend ONE for mainnet MVP, list invariants it upholds/breaks, sketch Cairo
changes (which functions/storage), Sepolia test plan, and cost estimate.
NO implementation in this task — decision doc only.

## Definition of done
- `docs/DESIGN-value-axis.md` exists with the 3 options compared + explicit
  recommendation + residual-trust-holes section.
- `docs/STATUS.md` updated to reference the decision.
- Kyami's approval on the chosen mechanism before any implementation begins.

## After this (queue)
(b) external security review of arena.cairo (custody!) → (c) dashboard off
devnet-session (`app.mjs` L580 hardcodes 127.0.0.1:4174) onto public RPC →
(d) mainnet ops: funded sponsor wallet, monitoring, fee budget (§14 pitfalls:
tip×gas counted in balance validation; declare ≈39 STRK actual).
