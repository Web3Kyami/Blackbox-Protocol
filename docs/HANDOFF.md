# HANDOFF — Next Task: Vercel deployment + judge demo bundle (mainnet-ready)

## Read first (in order)
1. `AGENTS.md` (root) — engineering rules
2. `docs/STATUS.md` — tail “Dashboard public-RPC mode VERIFIED” (2026-08-26)
3. `docs/ARCHITECTURE.md` + `docs/PRD.md` — Option B attested float, public RPC flow

## Context
**Dashboard public-RPC DONE 2026-08-26 VERIFIED:** `apps/web/src/dashboard-model.mjs` + `apps/web/src/app.mjs` now read B1 Sepolia arena `0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51` via `https://starknet-sepolia-rpc.publicnode.com` (no Alchemy key, no 127.0.0.1 hardwire). Stale selectors fixed (winner/settlement) + 13 Option B selectors added, `SEPOLIA_B1_DEFAULTS/STRATEGIES` + lenient u256 parsers + signed score decode (-200/-50) + `resolvePublicRpcConfig` (query ?network/rpcUrl/arena + localStorage bb:*) + attested float panel. `npm run verify` 40/40 + `scarb build` 0 + live publicnode re-derive all 7 view families + `dist/web` rebuilt and served.

## Next task — Vercel deployment + judge demo bundle
1. **Deploy `dist/web` to Vercel** (static). No env secrets needed (publicnode). If Vercel project exists, `vercel --prod` from repo root or push to main; else `vercel` init. Ensure build command `npm run build` outputs `dist/web`. Test deployed URL with `?network=sepolia` (B1 demo), `?network=sepolia&arena=0x52d02e...&rpcUrl=https://starknet-sepolia-rpc.publicnode.com`, and without params (devnet offline hint + form).
2. **Manual verification of deployed URL:** leaderboard shows Falcon (B1) LEADER -50 > Tortoise -200, attested float panel shows start 1000/peak 1000/maxDD 200/50/checkpoints 1/last 980/995, float_token 0x02d50cf..., rules_commitment 0xd4aed..., winner 0x3a01... Falcon, settlement 100, block number live, wallet connect visible. Devnet fallback still works locally (`npm run devnet:session` → Devnet Active).
3. **Judge bundle:** update `README.md` (network addresses, explorer links: voyager sepolia for B1 arena/adapter/txs, trust assumptions Option B, public RPC usage, local devnet instructions), add `docs/ARCHITECTURE.md` public RPC data flow diagram, ensure `docs/VALUE-AXIS-OPTIONS.md` + `.verification/option-b-attested-float.req.md` linked, include evidence `.local/open-round-evidence.b1.json` + crosscheck scripts in repo.
4. **Docs:** append `docs/STATUS.md` “Vercel deployment VERIFIED” with deployed URL + verification screenshots/curl, rewrite HANDOFF for next: fuzz/adversarial tests + snforge VPS (67 tests) or mainnet sponsor funding (RED — needs Kyami approval).

## Proof of completion
- Deployed Vercel URL returns 200, `?network=sepolia` renders B1 live state without devnet, attested panel and LEADER correct, wallet connect works; `npm run verify` still 40/40.
- `docs/STATUS.md` updated with deployed URL + live verification; commit with `Kyami <web3kyami@gmail.com>`.

## Invariants
- No mainnet value without Kyami approval (RED).
- No secret leaks (Alchemy key not in bundle; publicnode only).
- Every on-chain claim re-derived from live RPC, never logs alone.
