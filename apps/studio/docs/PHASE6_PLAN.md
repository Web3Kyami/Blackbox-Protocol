# Phase 6 — Dynamic Issuance Wizard (SPEC + PLAN)

**Status:** SUPERSEDED — 2026-08-30 repair pass #2 removed this prototype from
the Studio product surface. `register_policy` configuration is not evidence of
private-pass delivery, so the dashboard must not call it "issue". The isolated
SDK dry-run remains technical test coverage only; live broadcast remains
owner-gated and **UNVERIFIED**.
**Date:** 2026-08-29
**Build model:** per-action **dry-run default**. The wizard + dry-run are
implemented; no live broadcast was performed.
**Approval gate (S008 / AGENTS.md line 62–63):** `register_policy` is a Sepolia
write. Per your standing rule, Sepolia does NOT require the per-action Mainnet
approval — but you chose dry-run-first, so I will not broadcast to Sepolia until
you say `live` for that step either.

---

## 1. Goal
Let the connected org **issue a new capability policy** (a new "mandate") against
its already-deployed TreasurySpendAdapter + CapabilityToken, by calling the
Gatekeeper's `register_policy` entrypoint — wallet-native, no hardcoded addresses.

This is the write-path companion to the Phase 5 read-only dashboard. The dashboard
already shows existing policies; Phase 6 lets the org create the *next* one.

## 2. Scope (in)
- A wizard UI surface (`view: "issuance"`) reachable from an active
  dashboard policy's `Issue policy` action.
- Collect the 7 policy fields from the user:
  1. `capabilityToken` — pre-filled from the connected org's deployed token
     (read via `get_issuer()` round-trip; never hardcoded).
  2. `target` — the TreasurySpendAdapter address (pre-filled from token's
     `get_gatekeeper()` → adapter `get_config()`, read-only).
  3. `selector` — the adapter's spend selector (`getSelectorFromName("spend")`,
     derived, not hardcoded).
  4. `enforceFirstArgMax` — boolean (cap per-payment).
  5. `maxFirstArg` — max amount per payment (u128, in asset wei).
  6. `expiresAt` — unix seconds (> now).
  7. `reusable` — boolean (recurring vs one-shot).
- Validate with the existing `validatePolicy(input)` (reused, not rewritten).
- Build the call with the existing `buildRegisterPolicyCall(input)` (reused).
- **DRY-RUN:** render the exact calldata + target shape; do NOT
  broadcast. Surface a `?live=1&?approve-register-policy=1` gated broadcast path.
- On owner `live` approval for that step: broadcast via the wallet adapter
  (`account.execute([registerPolicyCall])`), then re-read the policy via
  Phase 5 indexer to confirm it appears (real evidence).

## 3. Scope (out)
- No NEW contract deployment. The wizard registers a policy on the *existing*
  deployed Gatekeeper/Token/Adapter. (Full Treasury Mandate *deployment* is
  Phase 4, already done — this phase only adds policies to an existing mandate.)
- No Mainnet. Sepolia only, and only on your explicit `live` per step.
- No holder-experience / shared-link flow — that is Phase 7.
- No arbitrary calldata (S016). Only the SDK-builder-produced calldata.

## 4. Reuse (mandatory)
- `src/sdk/blackbox-capability-sdk.mjs`:
  - `validatePolicy(input)` — input validation + field normalization.
  - `buildRegisterPolicyCall(input)` — exact `register_policy` calldata.
  - `buildPolicyStatusCall({gatekeeper, capabilityToken, active})` — for the
    dashboard's **revoke** button (sets `active=0`).
- `src/sdk/policy-reads.mjs`:
  - `getPolicy(provider, gatekeeper, token)` — read back the registered policy.
  - token `get_issuer()` / `get_gatekeeper()` + adapter `get_config()` — to
    discover the connected org's token/adapter without hardcoding.
- `src/sdk/org-policy-indexer.mjs` — `indexOrgPolicies(org)` re-run after issuance
  to confirm the new policy appears (real evidence).
- `src/ui/wallet.mjs` — `account.execute` broadcast behind `?live=1` + per-step
  `?approve-<stepId>=1`.

## 5. Files to add / change
- `src/ui/issuance.mjs` (NEW) — pure render: form fields, validation errors,
  dry-run preview, broadcast confirmation state.
- `src/ui/app.mjs` (MODIFY) — add `view: "issuance"`; wire `dashboard-new-mandate`
  → issuance; wire issuance `back`/`issued` transitions; on issued, refresh
  dashboard.
- `src/sdk/issuance-broadcast.mjs` (NEW, thin) — wraps `buildRegisterPolicyCall`
  + wallet `account.execute`, gated by `?live=1` + `?approve-register-policy=1`;
  in dry-run returns the exact call object.
- `test/phase-6-issuance.test.mjs`:
  - pure render: form → validation errors (zero max, past expiry) → dry-run
    preview shows correct calldata (assert via `buildRegisterPolicyCall`
    equality), no broadcast in dry-run.
  - live (REAL Sepolia, optional, on `live`): broadcast `register_policy`, then
    confirm the new policy is discoverable by `indexOrgPolicies` (real evidence).
    This sub-test is SKIPPED unless `?live=1&?approve-register-policy=1`.

## 6. Acceptance (gate)
- Wizard renders from connected org's real token/adapter (no hardcoded addresses).
- Dry-run shows exact `register_policy` calldata matching `buildRegisterPolicyCall`.
- No broadcast occurs unless `?live=1&?approve-register-policy=1` present.
- When broadcast (your `live` approval), the new policy is confirmed present via
  the read layer — real on-chain evidence, not a UI claim.
- `npm test` stays green (current suite: 95/95; the repair pass added
  regression coverage for resume normalization, already-declared skips, and
  `expiresAt === 0` classification).

## 7. Risks / things to confirm with you at build time
- **Selector for `spend`:** I'll derive `getSelectorFromName("spend")` against the
  deployed TreasurySpendAdapter. If the adapter's spend entrypoint has a different
  name, the call fails — I'll verify the selector against the deployed class first
  (as I did for `get_policy` in Phase 5).
- **`register_policy` caller requirement:** the Gatekeeper requires
  `caller == token.get_issuer()`. The connected org's account must be the token's
  issuer (`0x4ff9…6c8` is — confirmed in Phase 5). Safe.
- **Privacy pool / deposit:** out of scope for Phase 6; the wizard only registers
  the policy. Shielding/deposit remains a manual wallet step (documented, not
  automated).

## 8. Next actions after your approval
1. Build `issuance.mjs` + `issuance-broadcast.mjs` (dry-run default).
2. Wire `app.mjs` view transition.
3. Write `phase-6-issuance.test.mjs` (pure + dry-run).
4. Run `npm test`; report. NO live broadcast unless you say `live`.
