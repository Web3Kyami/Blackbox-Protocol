# HANDOFF — Next Task: f1 — Verifiable trade through whitelisted target

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — "Honest round v2" section is the current truth; round-1 section SUPERSEDED
3. `docs/DECISIONS.md` — D001–D016 (esp. D014, D016)
4. This file.

## Context (one paragraph)
Blackbox Arena = Starknet hackathon project where AI trading agents compete under pre-committed rules;
deterministic on-chain scorer picks winner and pays prize automatically. The honest-demo fix (#2 from
the Codex review) is DONE and chain-verified: `scripts/honest-round.mjs` runs a full round with one
scoped `ARENA_ADDR`, agent-wallet registrations, both actions ACCEPTED, FALCON winning on score,
settlement verified, and an independent 24-check cross-check (`scripts/open-round-crosscheck.mjs`)
re-deriving every claim from chain state. Evidence: `.local/open-round-evidence.json` (status VERIFIED).

## EXACT next task: f1 — contract-observed trade (kill the self-report)
The remaining credibility hole: `portfolio_value_after` and `drawdown_bps` are caller-supplied.
Fix so at least ONE action's value delta comes from on-chain balances, not the submitter.

### Steps
1. Pick a whitelisted target that holds the prize token (TestUSD already allowlisted as asset+target).
   Sponsor funds a small float to the target or to the strategy-controlled path.
2. Extend the action flow: before action → read `balance_of(strategy_escrow)` on the token contract;
   execute a real `transfer`/swap through the whitelisted target; after action → read balance again.
   Derive `portfolio_value_after = portfolio_value_before + (post − pre)` IN THE SCRIPT FROM READS,
   and record both reads + tx hash in the evidence step.
3. Contract side (optional but stronger): add a `submit_action_verified` variant that itself reads the
   token balance via dispatcher and rejects if `after != before + observed_delta`. If you change Cairo:
   scarb build, add Foundry tests, declare + redeploy (declare costs ~70 STRK — get Kyami approval),
   update class hash in scripts.
4. Rerun the honest round with the new flow; extend `open-round-crosscheck.mjs` to recompute the
   balance delta independently from token contract reads.
5. DoD: evidence file shows pre-balance, transfer tx, post-balance for at least one accepted action;
   cross-check recomputes the delta from the token contract alone; `npm run verify` green.

## Known gotchas (all hit live on Aug 24 — see skill starknet-sdk-pitfalls §11–§12)
- SDK default padded resource_bounds + high tip trip OZ account validation ("exceed balance") even
  with ample funds — ALWAYS pass tight manual bounds (raw named-params estimateFee ×1.15/×1.05, tip 1e12).
  Pattern lives in `sendTx()` in `scripts/honest-round.mjs`.
- Raw-RPC receipt events: `keys = [selector, ...keyed_fields]` — keyed fields start at index 1.
- Commitments/rules hashes: truncated sha256 (`.slice(0,60)`); full digest overflows felt252.
- Registrations must land BEFORE start_time; script uses +420s buffer — keep it.
- Falcon-style internal REJECTs are invisible without reading ActionSubmitted events +
  `get_action_counts`; never trust the ✅ log line alone.

## Wallets (Sepolia, post-run balances)
| Role | Wallet | Env file | Balance ~ |
|---|---|---|---|
| sponsor | burner C | `.local/burner-c.env` | ~915 STRK |
| agent | v2 | `.env.local` | ~74 STRK |
| spare | v1 | backup env | ~3,089 STRK |

Fees ran ~3–5 STRK per invoke during sequencer surge (Aug 24). A full honest round ≈ 30–40 STRK total.

## Remaining queue (after f1)
2. **f3**: Permissionless close/settle + fixed escrowed prize amount (contract change + redeploy)
3. Two independent agent wallets (kills the single-wallet limitation noted in evidence)
4. Cairo tests for `open_submit_action`
5. Demo video / hub packaging (needs Kyami approval)

## Definition of done for f1
See steps 4–5 above. Everything claimed in STATUS.md must be reproducible by running
`node scripts/open-round-crosscheck.mjs` against the fresh evidence file — exit 0.
