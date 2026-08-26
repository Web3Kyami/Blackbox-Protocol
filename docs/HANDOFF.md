# HANDOFF — Next Task: Dashboard public-RPC mode + mainnet readiness

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — “Honest round B1 VERIFIED” (2026-08-26)
3. `docs/VALUE-AXIS-OPTIONS.md` — Option B attested float (⭐ RECOMMENDED, now proven)

## Context
**B1 complete 2026-08-26 VERIFIED:** Arena `0x7ca7cd…0360` (P1+Option B) + Adapter `0x418d…00bc` deployed via `scripts/honest-round-b1.mjs` on Sepolia Alchemy; float_token `0x02d50c…b386` set before register, attest_start 1000e18 each, adapter-mediated actions 20 vs 5, permissionless checkpoints (poseidon, 980/995e18), spoof 5000 ACCEPTED but ignored (scores 980/995 → winner FALCON), permissionless close/settle (232s wait, T→F), withdraws 20/5e18 custody 0. Evidence `.local/open-round-evidence.b1.json` + crosscheck `scripts/open-round-crosscheck-b1.mjs` 33 checks exit 0 + legacy crosscheck exit 0 + `npm run verify` 40/40 + `scarb build` 0.

## Next task — dashboard public-RPC mode (mainnet-ready UI)
1. **Audit `apps/web/src/app.mjs` L580**: currently hardwired `http://127.0.0.1:4174/api/devnet/session` (“Devnet Active” only). Design public-RPC mode: direct `RpcProvider` reads (Alchemy) for leaderboard/evidence/winner, no devnet-session proxy. Keep devnet mode as fallback via env flag.
2. **Implement**: `get_action_adapter`, `get_registrant`, `get_attest_*`, `get_checkpoint*`, `get_score`, `get_winner`, `get_prize_*`, `get_settlement` via public RPC; render attest views (float_token, start/peak/maxDD, checkpoints) alongside scores; wire wallet connect for register/submit via public RPC (keep sponsor bootstrap separate).
3. **Verify**: `npm run verify` 40/40; manual Sepolia read against B1 arena `0x52d02e…4f51` shows live attested state; devnet mode still passes.
4. **Docs**: update `docs/ARCHITECTURE.md` (public RPC data flow), `docs/STATUS.md` (“Dashboard public-RPC DONE”), rewrite HANDOFF for audit/fuzz or mainnet deploy (RED — needs Kyami approval, no mainnet value without explicit sign-off).

## Proof of completion
- Web app reads B1 arena via public RPC (no 127.0.0.1:4174 required), displays attested scores + checkpoints, passes `npm run verify`.
- Commit with `Kyami <web3kyami@gmail.com>`; no mainnet spend without approval.

## Invariants
- No mainnet value without Kyami approval (RED).
- On-chain writes verified via receipts/events + view re-derive, never logs alone.
- Fee discipline: ask before STRK spend.
