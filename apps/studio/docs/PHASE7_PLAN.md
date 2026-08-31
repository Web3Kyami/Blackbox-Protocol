# Phase 7 — Holder Experience Plan

**Status:** COMPLETE (2026-08-29, dry-run default). The original Phase 7 suite had 9 tests; this repair pass adds the required expiry-classification regression and the current Phase 7 bucket is 10/10. See STATUS.md §Phase 7 for verification.

**Owner green-light:** "Continue" + "Do what's best abeg" (2026-08-29 re-prompt after model switch).

## Goal
Give a **capability-token holder** two things on the live Sepolia BBP policy:

1. A **read-only view** of their policy (budget, used, expiry, maxFirstArg, reusability, current state) — read via real RPC (`get_policy`, `get_privacy_pool`, adapter `get_config`, STRK `allowance`).
2. An **exercise path** that builds a real `privacy_invoke` Wallet-API action (via the SDK's `buildWalletApiCapabilityActions`) and broadcasts it — **dry-run by default**, gated behind `?live=1&?approve-exercise-policy=1`.

The holder is whoever owns the connected wallet's balance of the BBP capability token. The policy is discovered by resolving the token → its privacy pool (gatekeeper) → `get_policy(token)`.

## Boundaries
- **Holder = token balance holder.** We do NOT invent holder auth. In dry-run, the holder view shows whatever the token resolves to; in live mode, `privacy_invoke` is signed by the connected signer (the wallet enforces balance).
- **No shared-link / public URL gating (Phase 7-in-phase-9 territory).** The holder view is session-local: open the "+ Holder view" dashboard button, enter/pick the token, see your policy card.
- **No Mainnet.** Sepolia only. `WrongNetworkError` on any other chain.
- **Dry-run default.** Identical pattern to Phase 4 (`?live=1` + `?approve-<stepId>=1`). Live path not exercised in this phase.

## Data flow
```
dashboard (+ Holder view btn) → view:"holder", state.holder={token:"",view:"input"}
  holder-token  → validate address form; if valid, dispatch holder-load
  holder-load   → loadHolderPolicy(token):
                   getTokenMeta (issuer → privacy_pool) → get_policy(token)
                   → enriches adapter config + STRK allowance
                   → attaches nested record.policy (boundary adapter for SDK)
                   → record.state = record.state ?? classifyPolicy(record)
                   → setTree(reRender(..., view:"loaded"))
  holder-amount → edit issuance.amount field (for the exercise arg)
  holder-exercise → buildHolderAction(record, [amount])
                    → holderExercise(window.starknet, action, {stepId:"holder-exercise"})
                    → dry-run: synthetic 0xDRY… receipt, no chain call
                    → live (approved): provider.account.execute(...)
                    → setTree(reRender(..., view:"complete"))
  holder-back   → view:"dashboard", clear holder state
```

## Key decisions recorded in DECISIONS.md
- **S030:** `classifyPolicy` treats `expiresAt === 0` as `"active"` (never-expires per contract). Fixes latent Phase-5 bug surfaced by the live read.
- **S031:** exercise entrypoint = `privacy_invoke` on `CapabilityGatekeeper`; SDK builder = `buildWalletApiCapabilityActions`; `invoke` is the LAST action in the array; `invoke.contract` (not `contractAddress`); `calldata[0]` = token.
- **S032:** `loadHolderPolicy` attaches nested `record.policy` (SDK builders expect nested shape; indexer flattens). `buildHolderAction` constructs `rawPolicy` explicitly from flat fields.
- **P-005:** explicit `rawPolicy` construction (not `??` fallthrough) — robust to flat/nested record shapes.

## Files
- `src/sdk/holder-reads.mjs` (new) — `loadHolderPolicy`, `readPolicyRow` re-export.
- `src/sdk/holder-action.mjs` (new) — `buildHolderAction`, `submitHolderExercise`.
- `src/ui/holder.mjs` (new) — `renderHolder`, `exercisePanel`.
- `src/ui/dashboard.mjs` (modified) — "+ Holder view" button.
- `src/ui/app.mjs` (modified) — 5 holder handlers + dashboard-action routing.
- `src/ui/wallet.mjs` (modified) — exact live-mode and approval gates shared by write paths.
- `src/sdk/org-policy-indexer.mjs` (modified) — `classifyPolicy` expiresAt:0 fix + `toDashboardRecord` export.
- `test/phase-7-holder.test.mjs` (new, 10 tests after repair coverage).
- `test/secret-scan.test.mjs` (modified) — `scripts/` exemption (S033).

## Test matrix
1. renderHolder 6-state banner coverage
2. renderHolder error state
3. buildHolderAction calldata == direct SDK (byte-for-byte), `expiresAt:"4102444800"` synthetic
4. holderExercise dry-run: synthetic `0xDRY…` receipt, NO chain call
5. REAL Sepolia: `loadHolderPolicy(BBP)` — selector `0x534c516f…` (felt `1471750345…8102`), target=adapter, maxFirstArg=`"1"`, expiresAt=`1790565765`, state=active
6. `buildHolderAction` on REAL policy — `invoke` last in array, `invoke.contract`, `calldata[0]`=token
7. `NO_POLICY` rejects for non-token address (broadened RPC error catch)
8. `classifyPolicy(expiresAt=0)` → "active" / "revoked"

## Anomalies surfaced (anomaly duty — corrected in STATUS.md + HANDOFF.md)
- Phase 5/6 docs cited selector `0x79ccab4a` — that's the adapter's `spend` selector, NOT the policy selector. Real: `0x534c516f…`.
- maxFirstArg `10` was adapter's `set_limit_max_amount`. Real policy: `1`.
- expiresAt `0` was the uninitialized contract default; registered policy has `1790565765`.

## Not done (intentional)
- Phase 7 live `privacy_invoke` broadcast (not performed; dry-run verified). Requires `?live=1&?approve-exercise-policy=1`.
- Phase 8 (verification and documentation), Phase 9 (owner-gated integration
  planning only; no route or source integration in this pass).
- Browser verification (permanently blocked, S024).
