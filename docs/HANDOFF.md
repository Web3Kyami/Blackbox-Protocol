# HANDOFF — Next Task: declare new Arena class + escrowed honest round on Sepolia

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Cairo pass" section is the current state
3. Skills: `web3/blackbox-arena`, `web3/starknet-sdk-pitfalls` (§11 tight bounds!),
   `web3/onchain-verify-not-logs`
4. `scripts/honest-round.mjs` (v3, working reference) + `contracts/src/arena.cairo`

## Context
The Cairo pass is done and fully tested (47/47 snforge, 40/40 npm verify):
`open_submit_action_escrowed` (contract pulls + observes allocation via its own
balance delta), permissionless `settle()` paying exactly min(deposited, cap),
permissionless one-time `refund_escrow`. The deployed Sepolia class does NOT
have these yet — the next round must run against the NEW class.

## Steps
1. `cd contracts && scarb build` — get the new Sierra class hash from
   `target/dev/blackbox_arena_contracts_Arena.contract_class.json`
   (`starknet_keccak` of the sierra or use `scarb profile` / sncast declare output).
2. Update `NEW_ARENA_CLASS` in `scripts/honest-round.mjs`.
3. Extend the action step to use `open_submit_action_escrowed`: before submitting,
   each strategist wallet must `approve(ARENA_ADDR, units × price)` on TestUSD
   (price = 1e18, set pre-start), then call with
   `[receipt_id, commitment, asset, target, units, drawdown]` — no before/after
   params anymore.
4. Settle call becomes `settle()` with no args; add a `refund_escrow` call per
   action after settle; verify via `get_escrow(receipt_id) == 0` and wallet
   balances restored.
5. Run the full honest round (background, ~15 min): deploy → setup → register ×2 →
   prize → approve+escrowed actions ×2 → close → settle → refunds.
6. Extend `scripts/open-round-crosscheck.mjs`: assert contract-stored
   `get_escrow` matched the transferred amount at action time (from evidence),
   refunds executed, settlement == min(prize_deposited, 100).

## Definition of done
Crosscheck exit 0 against fresh `.local/open-round-evidence.json`; every write
verified per-tx from receipts/events (never logs-only). Declare costs ~70 STRK —
get Kyami's approval BEFORE declaring (RED line: spending).
