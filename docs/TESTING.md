# Testing

## Dual Verification Gates

Blackbox Arena provides two distinct, documented verification gates:

### 1. Fast Local Unit & Presentation Gate (`npm run verify`)

```sh
npm run verify
```

Runs fast, hermetic local checks without requiring Devnet to be running:
- Formatting checks (`scripts/format-check.mjs`)
- JavaScript syntax and lint checks across core, fixtures, and web code (`scripts/lint`)
- Public-state runtime type contract validation (`scripts/typecheck.mjs`)
- **28 Node.js unit tests** (`npm test`) — expanded to **40** across Phases 5–6:
  - 20 core mathematical & contract invariant tests (integer basis points, max drawdown, rule rejection, tie-breakers)
  - 8 frontend dashboard presentation behavior contract tests (`tests/web-dashboard.test.mjs`), proving offline banner rendering, score RPC error handling, empty live evidence behavior, zero fabricated default scores, strategy label mapping, and settlement result parsing.
  - 6 operator wallet self-service tests: wallet provider detection (Ready/Braavos/generic/absent/broken), commitment normalization (0x-prefix, hex-only, felt252 bounds), register-strategy call construction with exact selector, registrant binding parsing (bound / zero / RPC error / malformed — no fabrication), wallet error mapping (duplicate, closed round, user rejection), and selector constant format.
  - 6 evidence-completion tests: network label mapping for every surface, explorer URLs only for real networks (Devnet yields null — no fabricated links), receipt tx-reference rendering (hash always, anchor only with explorer, block number when present), canonical rules JSON (recursive key sorting, bigint decimal strings, array order preserved), evidence export payload shape (network label + arena address + rules commitment + exact receipts), and feed rendering with tx references.
- Production web bundle build (`scripts/build-web.mjs`)
- Pattern-based secret scan (`scripts/secret-scan.mjs`)

---

### 2. Live Devnet Integration Gate (`npm run verify:devnet`)

```sh
npm run verify:devnet
```

Executes the tracked integration suite in `packages/devnet-session/test/` against local Starknet Devnet `0.8.0-rc.3` with Scarb `2.17.0` in WSL `Ubuntu` (`kyami`):
1. **Stage A Session Foundation (`packages/devnet-session/test/stage-a-session.test.ts`)**:
   - Spawns Devnet and indexer, manages PID files, and cleans up child processes.
   - Deploys `Arena`, `ArenaAdapter`, and verifies one-time `set_action_adapter` lock on-chain.
   - Asserts zero secret keys or viewing keys in memory manifests or written `.local/devnet-session.json`.
   - Asserts static ABIs served via `/api/devnet/abi/*`.
2. **Stage B Dashboard & Security Integrity (`packages/devnet-session/test/stage-b-dashboard.test.ts`)**:
   - Queries `IArena.get_action_adapter()` on-chain to verify adapter address match.
   - Independently recomputes the expected SHA-256 rules digest from session parameters (`startTime`, `endTime`, `startingUnits`, allocation/drawdown limits, prize cap, `tokens.usdToken`, `MOCK_TARGET`) and asserts the on-chain `rules_commitment()` matches via BigInt comparison.
   - Asserts the sanitized manifest's `rulesCommitment` also matches the locally computed digest (format-safe).
   - Asserts the sponsor-set USD price in both `/api/devnet/session` and a direct `get_price` contract read equals `10^18`, with a non-zero on-chain timestamp.
   - Asserts score RPC error handling surfaces unavailable states without fallback fabrication.
   - Asserts `/api/devnet/evidence` is strictly empty on fresh session.
   - Asserts HTTP 403 Forbidden enforcement on untrusted origins.
3. **Stage C Real Lifecycle Controls (`packages/devnet-session/test/stage-c-lifecycle.test.ts`)**:
   - Authenticated strategy registration via `POST /api/devnet/register` (sponsor role check, duplicate rejection).
   - Real shielded action submission via `POST /api/devnet/submit-action` (valid Tortoise action, oversized Falcon action rejection $\rightarrow$ `ALLOCATION`, replay rejection $\rightarrow$ `DUPLICATE`, observer role rejection $\rightarrow$ 403).
   - Round close via `POST /api/devnet/close` (time advance, sponsor role check, on-chain winner derivation $\rightarrow$ `TORTOISE_COMMIT`).
   - Round settlement via `POST /api/devnet/settle` (prize cap $\le 100$, sponsor check, on-chain settlement record verification).
   - Origin security and zero secret exposures.
4. **E2E Privacy Pipeline (`packages/devnet-session/test/blackbox-arena.test.ts`)**:
   - Real STRK20 token mint, approval, and shielded note deposit.
   - Privacy SDK proof construction and `privacy_invoke` routing.
   - On-chain Tortoise scoring derivation (`final_value=1120`, `return_bps=1200`, `max_drawdown_bps=800`, `score_bps=400`).
   - Alice change-note discovery recovering full 1000 USD balance.
   - Falcon oversized allocation rejection and duplicate receipt replay rejection.

---

## Tracked Files for Clean Clone

All Blackbox-owned integration code is tracked under `packages/devnet-session/` (the gitignored `_research` folder contains only upstream reference checkouts):

```text
packages/devnet-session/
├── README.md
├── package.json
├── src/
│   ├── blackbox-session.ts
│   ├── harness.ts
│   ├── indexer-client.ts
│   ├── session-cli.ts
│   ├── timeouts.ts
│   ├── utils.ts
│   └── vesu-setup.ts
└── test/
    ├── stage-a-session.test.ts
    ├── stage-b-dashboard.test.ts
    ├── stage-c-lifecycle.test.ts
    └── blackbox-arena.test.ts
```

Latest verified result (2026-08-23, after Phase 4): **4/4 test files and 4/4 tests passed in 108.79 s** under WSL `Ubuntu` user `kyami`. Phase 4 additions covered by the suites: Stage B asserts contract-read registrants for all default commitments; Stage C asserts the settled prize actually moves (exact sponsor balance delta of 100 via artifact-ABI token Contract) and manifest `prizeToken`/`prizeDeposited`; the session funds the escrow (`mint` → `approve` → `deposit_prize(100)`) at setup.

Adapter conversion note: the E2E suite exercises `privacy_invoke`, which requires raw delivered tokens to equal `allocation × price` (D011 semantics: price is raw units per allocation unit). A latent inverted formula (`allocation × 10¹⁸ ÷ price`) was corrected in Phase 4; with the pinned `10¹⁸` USD price it had made every shielded action revert `BAD_AMOUNT`.

Gate runners: `bash scripts/run-fast-gate.sh` and `bash scripts/run-devnet-gate.sh` from the repo root inside WSL.

---

## Contract Unit Tests

```sh
cd contracts
scarb build
snforge test
```
Result: **38/38 contract tests pass** with Scarb 2.17.0 / Sierra 1.9.3 and Starknet Foundry 0.59.0.

New operator-binding tests (P4.2):
- `test_registrant_is_bound_at_registration` — permissionless registration binds the caller; distinct registrants recorded.
- `test_unknown_commitment_has_zero_registrant` — `get_registrant` returns zero for unknown commitments.

New settlement-payout tests (P4.3, D013), using `MockPrizeToken`:
- `test_deposit_and_settle_pay_registrant` — sponsor approves + deposits; settle pays winner's registrant (a non-sponsor account); balances and settlement record asserted.
- `test_settle_without_funded_prize_panics` — `NO_PRIZE` when escrow is unfunded.
- `test_deposit_prize_unauthorized_panics` / `test_deposit_prize_zero_panics` — `ONLY_SPONSOR` / `BAD_RULES`.
- `test_get_prize_token_view` — constructor prize token exposed.
- Case-study test updated: prize escrow funded before settling; outcome assertions unchanged.

New sponsor price-feed tests added in Phase 3:
- `test_set_price_success` — sponsor sets a pre-start price; views return value and timestamp.
- `test_set_price_unauthorized_panics` — non-sponsor caller triggers `ONLY_SPONSOR`.
- `test_set_price_unallowed_asset_panics` — unallowlisted asset triggers `BAD_ASSET`.
- `test_set_price_zero_panics` — zero price triggers `BAD_RULES`.
- `test_set_price_after_start_panics` — post-start call triggers `BAD_TIME`.
- `test_submit_action_without_price_rejected_stale_price` — action without an asset price returns `STALE_PRICE`.

New parity-breadth tests added in Phase 4 (P4.1), mapping JavaScript specification invariants (`packages/core/src/arena.mjs`) to Cairo:

| JS invariant | Cairo test |
|---|---|
| Rejected non-duplicate receipt consumed; replay with altered fields returns `DUPLICATE_RECEIPT` (D003) | `test_rejected_non_duplicate_receipt_is_consumed` |
| Receipt ID consumed even for unregistered strategy | `test_unregistered_receipt_consumed` |
| Action after end time returns rejection, not revert, and increments rejected count | `test_action_after_end_rejected_and_counted` |
| Action after explicit sponsor close rejected and counted | `test_action_after_explicit_close_rejected_and_counted` |
| Registration at exactly `start_time` panics (boundary) | `test_registration_at_exact_start_panics` |
| Registration one second before start succeeds (boundary) | `test_registration_one_second_before_start_succeeds` |
| Registered strategy with zero actions scores starting value / 0 bps / eligible | `test_zero_action_strategy_scores_neutral` |

Accounting parity note: both engines count a duplicate-receipt replay as an additional rejected action when the strategy is registered (JS `submitAction` generic rejection branch; Cairo identical). Verified by `test_rejected_non_duplicate_receipt_is_consumed` asserting `(accepted=0, rejected=2)`.

The full case-study outcome (Tortoise +400 winner, Falcon −100, Pulse ineligible) is contract-derived in `test_case_study_derives_tortoise_winner`; tie-break order in `test_tie_break_drawdown_and_registration_order`; integer truncation in `test_integer_return_basis_points_truncation`.

New multi-asset tests added in Phase 1:
- `test_add_allowed_asset_and_target` — sponsor registers a second asset/target pair; views confirm membership.
- `test_add_asset_unauthorized_panics` — non-sponsor caller triggers `ONLY_SPONSOR`.
- `test_add_duplicate_asset_panics` / `test_add_duplicate_target_panics` — duplicate registration rejected.
- `test_multi_asset_submission` — full round with actions on two asset/target pairs, including unknown-asset rejection (`BAD_ASSET`) and correct final score aggregation.
