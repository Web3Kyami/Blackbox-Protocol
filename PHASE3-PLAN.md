# Phase 3: Valuation Oracle Input — Implementation Plan

**Date:** 2026-08-23
**Status:** COMPLETE (Path A) — all verification gates passed

## Problem

Portfolio values (`portfolio_value_before`, `portfolio_value_after`) are self-reported inside the shielded action payload. The Arena contract has no way to verify these numbers against an external price feed. A strategy could claim any value it wants.

## Path A: Sponsor-Signed Price Feed — SELECTED AND IMPLEMENTED

### What Was Done

**Contract (`contracts/src/arena.cairo`):**
- New reason code: `STALE_PRICE`
- New storage maps: `latest_price: Map<ContractAddress, u128>` and `price_timestamp: Map<ContractAddress, u64>`
- New interface functions:
  - `set_price(asset, price)` — sponsor-only, callable only before round start, requires allowlisted asset and non-zero price. Emits `PriceSet` event.
  - `get_price(asset)` / `get_price_timestamp(asset)` — public views.
- `submit_action` now rejects with `STALE_PRICE` if no price has been set for the submitted asset.
- New event: `PriceSet { asset, price, timestamp }`.

**Tests (`contracts/tests/arena_test.cairo`) — 6 new tests added:**
- `test_set_price_success` — sponsor sets a price; views confirm value and timestamp.
- `test_set_price_unauthorized_panics` — non-sponsor triggers `ONLY_SPONSOR`.
- `test_set_price_unallowed_asset_panics` — unallowlisted asset triggers `BAD_ASSET`.
- `test_set_price_zero_panics` — zero price triggers `BAD_RULES`.
- `test_set_price_after_start_panics` — post-start call triggers `BAD_TIME`.
- `test_submit_action_without_price_rejected_stale_price` — submission on an asset without a set price returns `STALE_PRICE`.

The existing `deploy_arena()` helper now sets the asset price and locks the adapter while block time is explicitly before start, so every action-bearing legacy test has a valid price reference. The multi-asset test also sets a price for `ASSET2` before adding actions on it.

**Session (`packages/devnet-session/src/blackbox-session.ts`):**
- Deploy function calls `set_price(tokens.usdToken, 10^18)` immediately after `set_action_adapter`, before strategy registration.
- Manifest interface extended with `assetPrices: Record<string, { price: string; timestamp: number }>`.
- Manifest reads `get_price()` and `get_price_timestamp()` on-chain per tracked asset and exposes them in `/api/devnet/session`.

**Stage B test update (`packages/devnet-session/test/stage-b-dashboard.test.ts`):**
- Asserts manifest contains the USD token's price equal to `10^18` and a nonzero timestamp.
- Directly queries `get_price()` on-chain via starknet.js and confirms it matches `10^18`.

### Verification Record

- Contract tests: **24 passed, 0 failed** (`snforge test`).
- Devnet suites: **4 files passed, 4 tests passed**, duration **100.28 s**.
- Documentation updated:
  - `docs/STATUS.md` records Phase 3 as verified.
  - `docs/DECISIONS.md` adds D011 for the sponsor-owned pre-start price gate.
  - `docs/TESTING.md` records 24/24 contract tests and the Stage B price assertions.

Important scope note: this is a contract-owned sponsor reference price, not a decentralized oracle. It guarantees that no action is scored without a pre-start valuation reference; it does not yet independently verify self-reported portfolio values against an external source.

**Contract changes:**
- New storage: `latest_price: Map<ContractAddress, u128>`, `price_timestamp: Map<ContractAddress, u64>`
- New sponsor-only function: `set_price(asset, price)` callable only before round start
- `submit_action` validation: if a signed price exists for the asset, require `portfolio_value_before` and `portfolio_value_after` to be consistent with that price (exact check TBD during implementation)

**Session changes:**
- Deploy function calls `set_price()` for each allowed asset before registration opens
- Stage B test verifies `get_price()` returns the expected value
- Stage C test submits an action with wrong value and confirms rejection

**Pros:** No new dependencies. Fastest to implement. Proves the concept.
**Cons:** Trusts the sponsor. Not decentralized.

### Path B: Pragma Oracle Integration

Use Pragma's Starknet-native oracle for price feeds. More credible but adds a dependency and integration surface.

**Contract changes:**
- Add Pragma oracle interface dispatcher
- `submit_action` queries oracle for asset price at action timestamp
- Validate portfolio values against oracle data

**Session changes:**
- Configure Pragma contract address in session setup
- Tests use mock oracle or Devnet-compatible deployment

**Pros:** Decentralized, production-grade.
**Cons:** Requires Pragma SDK/deployment on Devnet. More complex. Slower to ship.

## Recommendation

Start with Path A. It proves the validation logic without external dependencies. Path B can replace Path A later by swapping the price source without changing the Arena scoring logic.

## Implementation Order

1. Contract: add `set_price()`, storage maps, and validation in `submit_action`
2. Foundry tests: price setting, unauthorized caller, stale price rejection, value mismatch rejection
3. Session code: deploy-time price setting + manifest exposure of current prices
4. Stage B test update: verify on-chain price matches manifest
5. Stage C test addition: wrong-value submission rejected with new reason code
6. Docs update after all gates pass

## New Reason Code

- `STALE_PRICE` — submitted when no valid price exists for the requested asset at action time

## Verification Gates

| Gate | Result |
|---|---|
| Fast gate (`npm run verify`) | PASSED — 28/28 local tests |
| Foundry tests (`snforge test`) | PASSED — 24/24 |
| Devnet integration (`npm run verify:devnet`) | PASSED — 4/4 in 100.28 s |
