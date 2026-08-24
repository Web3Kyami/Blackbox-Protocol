# Phase 2: Rules Commitment Hardening — COMPLETE

**Date:** 2026-08-22
**Status:** VERIFIED — all gates pass

## What You Need To Do

Nothing. Phase 2 is fully verified.

| Gate | Result |
|---|---|
| Fast gate (`npm run verify`) | 28/28 tests, format/lint/typecheck/build/secret-scan clean |
| Devnet integration (`npm run verify:devnet`) | 4/4 suites passed in 132.72 s |
| On-chain rules digest | Matches locally recomputed SHA-256 (verified by Stage B) |

## Docs Updated

- `docs/STATUS.md` — Phase 2 recorded as VERIFIED with SHA-256 mechanism details
- `docs/DECISIONS.md` — D010 added; open decision on rules commitment closed
- `docs/TESTING.md` — Stage B updated to describe independent digest recomputation and BigInt comparison

Ready for Phase 3 whenever you are.

## Are We Ready For Phase 3?

Not yet. Phase 2 must pass on-chain verification first. Once `npm run verify:devnet` passes, I'll update docs and we start Phase 3 immediately.

Phase 3 preview: replace self-reported portfolio values with sponsor-signed price feeds (simpler path first) or Pragma oracle integration. Design choice needed before implementation.

## Current State

Two systems track rules commitments today, and they do not agree.

**Core engine** (`packages/core/src/arena.mjs`):
- Already computes a real SHA-256 hash via `commitRules()`.
- Canonicalizes the rules object (sorted keys, deterministic serialization), hashes it, and returns a `0x` hex string.
- Tests confirm `commitRules(arena.rules)` equals `arena.rulesCommitment`.

**Devnet session** (`packages/devnet-session/src/blackbox-session.ts`):
- ~~Hardcodes `RULES_COMMIT = "0x52554c45535f5631"`~~ → FIXED. Now computes SHA-256 from actual params.
- ~~Passes this constant to the Arena constructor.~~ → FIXED. Passes computed digest.
- ~~Stage B test asserts against hardcoded value.~~ → FIXED. Asserts against locally recomputed digest.

The contract stores whatever felt252 it receives. The gap was entirely off-chain: the session deployed with a human-readable label instead of a cryptographic digest. This is now fixed in code but needs on-chain verification.

## Goal

Replace the hardcoded `'RULES_V1'` felt with a SHA-256 digest computed from the actual game parameters, using the same canonicalization logic as the core engine. After this change, anyone can independently verify that the on-chain commitment matches the rules by recomputing the hash locally.

**This goal is now implemented. Pending: devnet verification.**

## Changes

### 1. `packages/devnet-session/src/blackbox-session.ts`

- DONE. Added `canonicalizeRules()` + `computeRulesCommitment()`. Removed old constant. Deploy function now computes from actual params and truncates SHA-256 to 31 bytes for felt252.

### 2. Test updates

**`packages/devnet-session/test/stage-b-dashboard.test.ts`:**
- DONE. Computes expected digest from session's own values. Asserts both manifest and direct contract read via BigInt comparison (format-safe).

**`packages/devnet-session/test/stage-c-lifecycle.test.ts` and `blackbox-arena.test.ts`:**
- DONE. Removed unused imports.

### 3. Contract side

No contract changes required. `Arena` already accepts and stores any `felt252` as `rules_hash`. The improvement is entirely in what value gets passed at deploy time.

## Verification Plan

1. ~~Run `npm run verify` (fast gate).~~ DONE — 28/28 passed.
2. User runs `npm run verify:devnet` — PENDING.
3. Confirm on-chain digest matches locally computed SHA-256 — PENDING.
4. Update docs after all gates pass — PENDING.

## What This Unlocks

- Participants can independently verify game parameters before joining a round.
- Rules become tamper-evident: any change to allocation limits, drawdown thresholds, asset allowlists, or timestamps produces a different digest.
- Prepares for Phase 3 (oracle input) where the scorer needs to know which price feed was active when the round was configured.
