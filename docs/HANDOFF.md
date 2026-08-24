# HANDOFF — Next Task: Fix honest-round.mjs address scoping and rerun

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — current state, including the CORRECTED open_submit_action section
3. `docs/DECISIONS.md` — D001–D016 (esp. D014, D016)
4. This file.

## Context (one paragraph)
Blackbox Arena = Starknet hackathon project where AI trading agents compete under pre-committed rules;
deterministic on-chain scorer picks winner and pays prize automatically. Phase 7 verified on Sepolia.
New Arena class with `open_submit_action` is declared (0x072c7b99…54b). Codex CLI review flagged:
self-reported scores, disconnected agent runtime, placeholder commitments, single-wallet demo.
We are mid-fix #2 ("honest demo") — see below. Skill `web3/onchain-verify-not-logs` exists; LOAD IT FIRST.

## EXACT next task
Fix `scripts/honest-round.mjs` arena-address scoping bug and rerun the full loop with verification.

### The bug
The script deploys Arena → gets `arenaAddr` from UDC event, but action submission /
verification used a stale/different arena address. Result: actions landed on one arena,
close+settle ran against another with zero actions → `NO_WINNER`.

### Fix steps
1. Open `scripts/honest-round.mjs`. Ensure ONE `const arenaAddr` flows to every later step
   (setup, register, actions, close, settle). No globals, no re-derivation.
2. After EVERY write tx, verify via view function (per skill `web3/onchain-verify-not-logs`):
   - after setup → `get_action_adapter` ≠ 0
   - after each register → `get_registrant(commitment)` == submitter address
   - after each action → `get_action_counts(commitment)` incremented ON THE SAME arenaAddr
3. Rerun: `node scripts/honest-round.mjs`
4. Then run close+settle against THE SAME arenaAddr (fix `/tmp/minimal-close.mjs` or inline it).

### Known gotchas
- Commitments/rules hashes MUST be truncated sha256 (`.digest("hex").slice(0,60)` = 240 bits);
  full 256-bit values overflow felt252 → "felt overflow".
- UDC v2 entrypoint is `"deploy_contract"` (snake_case), not `"deployContract"`.
- Devnet/Sepolia block timestamps freeze without txs — advance blocks before `close`.
- Surge gate rejects declares/invokes when balance is low even if arithmetic passes.
- Fee-tight pattern already in script: estimate → bounds ×1.15/+5% → execute → verify state.
- NEVER claim success without a chain-read confirming state changed.

## Wallets (Sepolia)
| Role | Wallet | Env file | Balance ~ |
|---|---|---|---|
| sponsor | burner C | `.local/burner-c.env` | ~1,212 STRK |
| agent | v2 | `.env.local` | ~17 STRK |
| spare | v1 | backup env | ~3,089 STRK |
| spare | burner B | not deployed | 0 |

## Remaining queue (after this task)
1. **f1**: Verifiable trade through whitelisted target (contract-observed balances, no self-report)
2. **f3**: Permissionless close/settle + fixed escrowed prize amount (contract change + redeploy)
3. Cairo tests for `open_submit_action`

## Definition of done for this task
Fresh round on Sepolia where: both strategies registered from agent wallet (registrant verified),
both actions submitted AND `get_action_counts` shows ≥1 accepted each on the same arena that
closes/settles, winner derived on-chain, settlement recorded. Evidence saved to
`.local/open-round-evidence.json` with real tx hashes. `npm run verify` green.
