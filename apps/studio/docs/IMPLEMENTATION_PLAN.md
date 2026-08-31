# Implementation plan

## Phase 0 — Architecture and safety boundary

- Read `docs/REUSE_MAP.md` and treat the existing protocol as the immutable
  implementation source of truth.
- Audit existing constructors, interfaces, SDK builders, and class hashes.
- Map every Studio field to a contract-enforced constraint.
- Define transaction order, address prediction, recovery, and disclosures.
- Copy only required code into Studio.
- Produce a reuse/provenance inventory proving that no replacement protocol is
  being designed.

Gate: architecture is documented and no Mainnet write occurs.

## Phase 1 — Studio foundation

- Create isolated application structure and build commands.
- Build Studio home, navigation, wallet connection, template selector, dashboard
  empty state, and responsive shell.
- Prioritize protocol-team outcomes over developer content.

Gate: all routes and empty states work without fake data.

## Phase 2 — Treasury Mandate wizard

- Implement Treasury, Limits, Behavior, Operator, Privacy Review, and Deployment
  Review steps.
- Add deterministic normalization and validation.
- Add save/restore draft behavior without secrets.

Gate: invalid configurations cannot produce a deployment plan.

## Phase 3 — Deployment planner

- Generate real class reuse, constructor, address, registration, mint, and
  allowance plans.
  - **NOTE (S026, 2026-08-29):** Fee-estimation plans were dropped from the
    original Phase 3 gate per owner instruction. The BlackBox SDK has no
    fee-estimation concept (verified: `grep -i 'fee\|estimate\|gas'` = 0
    hits in SDK). BlackBox uses gas abstraction via relayer; fees are
    budgeted at deploy time, not estimated client-side. This is a
    documented gap, not a weakening — test 10b still proves plan shapes
    match the real SDK. A frontier reviewer or future Phase 5+ can add
    fee-budget estimation if needed.
- Add public configuration and SDK-code export.
- Add public configuration and SDK-code export.
- Test generated calls against existing interfaces.

Gate: output is executable data, not decorative pseudocode.

## Phase 4 — Wallet-reviewed deployment

- Submit each deployment/setup step through a compatible connected wallet.
- Reconcile transaction receipts and onchain state.
- Resume safely after refresh, cancellation, or partial completion.

Gate: full flow passes in a safe supported environment. Mainnet remains
owner-approved separately.

## Phase 5 — Dashboard and history

- Discover organization-controlled policies using real public data.
- Show active, draft, expired, and revoked states.
- Show budget, uses, expiry, addresses, receipts, and explorer links.
- Add export, issue, share, and revoke entry points.

Gate: no sample data is presented as connected-wallet data.

## Phase 6 — Dynamic issuance

- Select any Studio-created Treasury Mandate.
- Read pool fee and allowances.
- Submit wallet-native STRK20 delivery.
- Confirm receipt before recording completion.
- Generate a policy-specific holder link.

Gate: no policy, issuer, holder, token, or adapter address is hardcoded.

## Phase 7 — Dynamic holder experience

- Load a public policy from the shared link.
- Implement all wallet, permission, expiry, revocation, transaction, and
  completion states.
- Execute only the policy-defined action.

Gate: no fake capability inventory or duplicate confirmed action.

## Phase 8 — Verification and documentation

- Test validation, normalization, planning, recovery, dashboard reads, issuance,
  holder states, responsiveness, links, and secret scanning.
- Update all Studio continuation documents.

Gate: Studio verification passes and `docs/STATUS.md` contains exact evidence.

## Phase 9 — Integration and production

- Integration into the existing build or `/studio` route requires explicit owner
  permission because it crosses the isolation boundary.
- Verify production routes and assets.
- Prepare the video flow with clear verified/unverified labels.

Gate: existing BlackBox production routes remain unchanged and working.

## Priority if time is constrained

1. User-first Studio shell.
2. Valid Treasury Mandate wizard.
3. Real deployment planner.
4. Dashboard.
5. Dynamic issuance.
6. Holder link.
7. Mainnet broadcasting last.
