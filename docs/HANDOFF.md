# HANDOFF — Next Task: f1 contract-side — Arena-observed value deltas

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Honest round v3" section is the current state
3. Skill `web3/blackbox-arena` + skill `onchain-verify-not-logs`
4. `scripts/honest-round.mjs` (v3, working reference) + `scripts/open-round-crosscheck.mjs`

## Context
Round v3 is fully chain-verified: two independent strategist wallets, real
transfers through the whitelisted target, values derived from balance reads,
35-check independent crosscheck exit 0. The remaining trust hole is D012:
the action's `portfolio_value_before/after` are still CALLER-SUPPLIED calldata.
The script now reports them honestly, but the contract cannot enforce it.

## Task
Make the Arena derive the value delta itself for actions whose asset/target are
ERC-20-shaped. Design options (pick one, justify in STATUS):
- **Option A (read via adapter):** adapter (already privileged) does
  `IBalances.asset.balance_of(strategy_registrant)` before/after the routed call
  and passes observed deltas to `submit_action`; Arena stores them.
- **Option B (Arena reads):** Arena calls back into the token via
  `starknet::call_contract` at settle/action time (library-call restrictions
  apply; dispatcher pattern needed).
- **Option C (event-based attestation):** require the tx that called
  `open_submit_action` to contain an ERC-20 Transfer event to the whitelisted
  target from the registrant, and parse amount from it (cheapest, no new trust).

## Steps
1. Modify `contracts/src/arena.cairo` (+ adapter if Option A) with the chosen
   mechanism; keep `open_submit_action` backward-compatible or bump selector.
2. Add Cairo tests in `contracts/tests/` covering: honest transfer, mismatched
   self-report vs observed delta (must REJECT), non-whitelisted target.
   Bundle f3 here too: permissionless close/settle + fixed escrowed prize
   (`prize_cap` honored exactly), since they touch the same file — ONE declare.
3. `scarb build && scarb test` green locally (Foundry suite currently 31/31+).
4. Declare new class on Sepolia (~70 STRK — needs Kyami approval) + rerun
   `scripts/honest-round.mjs` against the new class hash.
5. Extend crosscheck: assert reported deltas == chain-replayed balances AND ==
   contract-stored observed values.

## Definition of done for f1
Crosscheck proves three-way agreement: script claim == chain balance replay ==
contract-stored value. Everything in STATUS.md reproducible by running
`node scripts/open-round-crosscheck.mjs` against the fresh evidence file — exit 0.
