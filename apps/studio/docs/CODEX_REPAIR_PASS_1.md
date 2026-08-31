# BlackBox Studio repair pass #1

**Date:** 2026-08-30
**Scope:** `apps/studio/` only
**Result:** complete for this repair pass; Phase 9 integration remains owner-gated.

## What was verified

- Read and reconciled the Studio source and required docs. The pre-repair test
  inventory is 91 tests, not 92: `37 + 17 + 6 + 2 + 7 + 9 + 7 + 2 + 4`.
- Ran `npm test` from `apps/studio/`: final tail was `tests 95`, `pass 95`,
  `fail 0`, `cancelled 0`, `skipped 0`.
- Ran `npm run verify` from `apps/studio/`: final tail was `tests 95`,
  `pass 95`, `fail 0`, `cancelled 0`, `skipped 0`.
- Ran Node syntax checks over every `src/**/*.mjs`; changed non-browser modules
  imported successfully. Result: `changed module imports: ok`.
- Counted test declarations with `rg -c '^test\\(' test/*.test.mjs`:
  `37, 19, 6, 3, 7, 10, 7, 2, 4 = 95`.
- Ran the focused wizard/wallet/dashboard/issuance/holder tests: `50 pass,
  0 fail`. The holder suite’s live-read cases passed against the public
  Cartridge Sepolia RPC and the real BBP policy; no write was attempted.
- Cross-checked Cairo entrypoints with `rg` under `contracts/src/`: Gatekeeper
  `get_policy(token)`, CapabilityToken metadata/control views, argument-less
  adapter `get_config()`/`get_total_spent()`, and ERC-20 `allowance(owner,
  spender)` match Studio’s read calls.
- Boundary import scan found no `src/` import resolving above `apps/studio/`.
  Source secret-pattern scan found no private-key/seed/viewing-key/auth-token
  literals and no production `console.log` calls. The existing SDK provenance
  banner has public historical class-address comments; its byte-identical body
  was deliberately preserved and no runtime path uses those comments.
- Final parent `git status --short` showed the same pre-existing parent changes
  plus `?? apps/studio/`; no parent file was edited by this pass.

## What was fixed

- `src/ui/wizard.mjs`, `src/ui/app.mjs`, `test/phase-1-smoke.test.mjs`: split
  the five-step merged review into the six USER_FLOW steps, kept wallet
  `enable()` browser-only, and verified `computePlan` calls the real SDK.
  Privacy and deployment review now have separate gates. Recorded in S037 and
  setback S-15.
- `src/ui/wallet.mjs`, `src/sdk/issuance-broadcast.mjs`,
  `src/sdk/holder-action.mjs`, `src/ui/app.mjs`: enforced exact
  `?live=1&?approve-<stepId>=1` authorization, Sepolia-only writes, successful
  receipt verification, explicit skipped declarations, and honest unknown/live
  pending states. Recorded in S038 and setback S-16.
- `src/sdk/policy-reads.mjs`, `src/sdk/org-policy-indexer.mjs`: read public
  token metadata and validate token/gatekeeper/adapter/asset relationships;
  classify `expiresAt === 0` as never-expiring when active; use chain metadata
  in dashboard rows. Recorded in S039 and setbacks S-17.
- `src/sdk/holder-reads.mjs`, `src/ui/holder.mjs`, `src/ui/app.mjs`: resolve
  holder wiring from the linked token and adapter views, map non-token RPC
  failures to `NO_POLICY`, and render input/loading/loaded/complete/error/back
  states with a guarded exercise panel. Recorded in S040 and setbacks S-18/S-19.
- `src/ui/wizard.mjs`, `src/ui/wallet.mjs`, `test/phase-4-wallet.test.mjs`:
  normalize corrupt/non-contiguous resume data and represent verified
  already-declared classes as explicit skips. Recorded in S041 and setback
  S-20.
- `package.json`, docs: added the required in-scope `verify` script after the
  command was found undefined. Recorded in S042 and setback S-21.
- `src/sdk/studio-network.mjs`, `src/sdk/org-policy-indexer.mjs`,
  `src/sdk/holder-reads.mjs`, `src/ui/wizard.mjs`, `src/ui/app.mjs`: removed
  deployed contract address defaults from production source. Dashboard and
  wizard require integration-owned public runtime configuration; holder asset
  resolution comes from the linked adapter. Live-read fixtures retain explicit
  verified addresses only in tests. Recorded in S043 and setback S-22.
- `docs/STATUS.md`, `docs/HANDOFF.md`, `docs/DECISIONS.md`,
  `docs/SETBACKS.md`, `docs/PHASE6_PLAN.md`, `docs/PHASE7_PLAN.md`,
  `docs/PHASE9_PLAN.md`, `docs/VIDEO_LABELING.md`: reconciled test counts,
  Phase 8 verification-only framing, Phase 9 planning-only status, expiry
  wording, and historical selector citations.

## Test-the-tests evidence

- `test/phase-5-indexer.test.mjs` calls `indexOrgPolicies` with explicit live
  Sepolia fixture configuration, checks issuer/token/state/budget/link data,
  and now separately proves the indexer refuses missing address configuration.
- `test/phase-7-holder.test.mjs` compares `buildHolderAction` directly with
  `buildWalletApiCapabilityActions` and mutates the first argument to require
  changed calldata; it also performs live BBP reads and the `NO_POLICY` path.
- `test/phase-4-wallet.test.mjs` mutates/removes the mint queue entry and now
  tests resume normalization plus explicit already-declared skips.
- `test/secret-scan.test.mjs` scans the Studio tree against its documented
  patterns and passes; the known deploy-script false positive remains an
  explicit `scripts/` exemption documented in S033.
- `test/sdk-parity.test.mjs` and `test/wallet-utils-parity.test.mjs` read the
  upstream and Studio files from disk and compare hashes/body content, so they
  detect upstream drift rather than only checking an in-memory snapshot.

## What could not be verified

- **UNVERIFIED — live deployment/issuance writes:** no wallet signature,
  broadcast, declare, deploy, allowance, mint, or register-policy action was
  performed. The unsigned SDK plan lacks artifact-backed declaration/deployment
  data, so those live queue steps refuse dispatch.
- **UNVERIFIED — live holder exercise:** the STRK20 wallet-relay path requires
  an owner-controlled compatible Sepolia wallet and proof/relay environment.
  Dry-run action calldata is SDK-backed and tested, but no real exercise was
  broadcast.
- **UNVERIFIED — browser/CDP:** blocked permanently by owner directive S024;
  pure-render tests and live-read RPC tests are the verification of record.
- **UNVERIFIED — Phase 9 production-route gate:** parent `apps/web/` is dirty
  versus HEAD and is outside this task’s write boundary. `/studio` integration
  was not attempted.

## Remaining open work

- Owner must supply/approve the runtime public network configuration and any
  artifact-backed Sepolia deploy adapter before enabling a live deployment.
- Owner must perform the STRK20-capable holder exercise if live privacy-relay
  evidence is required.
- Phase 9 route/build integration remains planning-only and requires explicit
  owner approval; no Studio source has been merged into `apps/web/`.

## Decision and setback index

The corrections are recorded in `docs/DECISIONS.md` S036–S043 and the honest
error log in `docs/SETBACKS.md` S-15–S-22. Historical stale selector/expiry
strings remain only in explicitly labelled audit-history entries; no active
code, fixture, or current status claim propagates them.
