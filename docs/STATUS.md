# Status

Last updated: **2026-08-23** — Phases 4–6 VERIFIED (Foundry 38/38, fast gate 40/40, Devnet 4/4). **Phase 7 (Sepolia rehearsal) IN PROGRESS — interrupted mid-deployment for session handoff.**

## Phase 7 exact position (handoff state)

**Done on Sepolia:**
- Disposable deployer account `0x20853c681f6b669eac02a0e04ede83ff413f2396eea3b52568c6c14f66e850b` deployed (OZ v1.0.0, DEPLOY_ACCOUNT tx `0x2554cd0fa6cec0ad59d6c4efb0204b7cf694b62db83afa71897798055bed700`). Credentials in gitignored `.env.local`.
- Funded ~100 STRK via faucet (tx `0x258b6816c25918bb0cc702ce578c848a91e224375e94a4093875ac7f4fdedce`); balance ≈ 85 STRK after fee burns.
- Prize token (TestUSD) declared + deployed: `0x734ebf9f1494a3b82ae36aa08b5aa7be5287ada306a5bd48a94f278d6f6849a`. ⚠️ Multiple duplicate TestUSD instances exist from earlier partial runs — always verify liveness and use the state file's address.
- RPC: **Alchemy works completely** (`https://starknet-sepolia.g.alchemy.com/v2/$ALCHEMY_API_KEY`), including native fee estimation. All free alternatives verified broken (see D015).

**Blocked / decided:**
- Pool self-declaration blocked by sequencer admission economics → D014: scoped rehearsal without pool.
- Arena declare measured at **844,860,800 l2_gas actual (~41 STRK real cost; Alchemy estimates 1.267B max units ≈ 61 STRK worst-case)**. With ~85 STRK balance this is borderline — recommend topping up ≥ 50 STRK before the full run.

**Immediate next steps (in order):**
1. Refactor `scripts/sepolia-deploy-round.mjs`: replace the `submitMeasured` guess-and-grow loop with direct Alchemy estimation (`estimateDeclareFee` / estimate-in-`execute`) — probe in `scripts/probe-estimate.mjs` proves it returns real bounds.
2. Reconcile token duplicates; pin canonical TestUSD in state before anything else.
3. Run round with fresh timestamps: setup multicall (adapter lock → price → registers → approve+escrow) → wait real end-time → close → settle → verify winner payout delta on-chain. Close/settle script not yet written — model on the deploy script's structure.
4. Evidence: addresses/hashes → `strk20.json` (contracts field, Sepolia-labeled) + `docs/NETWORKS.md` Green/Yellow classification.
5. Rerun all gates; update this file to VERIFIED per item.

**Key scripts:** `scripts/sepolia-status.mjs` (balance/deploy status), `scripts/probe-estimate.mjs` (estimation probe), `scripts/sepolia-declare-pool.mjs` (raw signed declare — working technique, blocked only by D014 funding), `scripts/create-sepolia-account.mjs`, `scripts/run-fast-gate.sh`, `scripts/run-devnet-gate.sh`.

 **Phase 7 started**: disposable Sepolia deployer account funded (~100 STRK) and deployed (OZ v1.0.0); working public RPC verified; next = D014 scope decision on shielded-action proofs, then contract deployment.

## Real and passing

- Repository structure, documentation, case-study fixture, deterministic Arena engine, evidence projection, score/tie-break logic, and web source.
- **28/28 local Node.js tests pass with no skips (`npm run verify`)**, including 20 core mathematical & invariant tests and 8 frontend dashboard presentation & settlement behavior contract tests.
Cairo contracts compile with Scarb 2.17.0 / Sierra 1.9.3; **31/31** Foundry 0.59.0 tests pass with no skips, including multi-asset allowlists, duplicate and authorization rejection, sponsor price setup, stale-price rejection, cross-asset action submission, unknown-asset rejection, and Phase 4 parity breadth (rejected-receipt consumption, post-end/post-close rejection counting, registration time boundary, zero-action neutral scoring). New read-only view `get_action_counts(commitment)` exposes accepted/rejected counters for evidence use.
- **Phase 4 pre-mainnet product completion is in progress** per `PHASE4-PLAN.md`:
  - P4.1 parity breadth VERIFIED (31/31 Foundry at the time; mapping table in `docs/TESTING.md`); new view `get_action_counts(commitment)`.
  - P4.2 operator binding: `registrant` in `StrategyState`, emitted in `StrategyRegistered`, `get_registrant()` view, manifest `strategyRegistrants`, Stage B assertions. Code complete; verification pending.
  - P4.3 settlement payout (D013): constructor `prize_token`, sponsor `deposit_prize` escrow via approval + `transfer_from`, paying `settle()` with `NO_REGISTRANT` / `NO_PRIZE` guards and `PrizePaid` event; `MockPrizeToken` for Foundry; session funds escrow and exposes `prizeToken`/`prizeDeposited`; Stage C asserts exact winner balance delta. Code complete; verification pending.
  - P4.4 D012 merged: self-reported after-value accepted as documented trust assumption.
- **Adapter price-conversion bug fixed during Phase 4 verification**: `privacy_invoke` computed expected raw amount as `allocation × 10¹⁸ ÷ price`; correct semantics (price = raw token units per allocation unit, per D011) is `allocation × price`. With the pinned `10¹⁸` USD price every shielded action previously reverted `BAD_AMOUNT`; the E2E pipeline now passes end-to-end.
- **Phase 5 operator wallet self-service (in progress)**:
  - Wallet connect via injected Starknet Wallet API (`window.starknet`) — zero external dependencies; detects Ready (Argent), Braavos, and generic implementations.
  - "Join With Your Own Wallet" flow: validates commitment input against felt252 bounds, signs and sends `register_strategy` directly from the browser wallet, then verifies the on-chain registrant binding via `get_registrant` before reporting success.
  - Leaderboard registration list now displays the contract-read registrant per strategy from the sanitized manifest.
  - Server-held signers remain only for sponsor/bootstrap operations, labeled local-devnet-only. No keys, prompts, or viewing keys touch the web layer.
  - Remaining Phase 5 item: none blocking; server-signer demotion for sponsor controls is deferred to Phase 6 polish with explicit UI labeling.
- **Phase 6 dashboard evidence completion (shipped)**:
  - Per-receipt transaction references in the live evidence feed (hash + block number captured at submission); explorer anchors render only on networks that have one — Devnet rows show the hash without a fabricated link.
  - Network labels: `networkLabelFor()` drives a single authoritative label (`SIMULATED / LOCAL DEVNET / SEPOLIA / MAINNET / OFFLINE`) applied to leaderboard/evidence headings and footer; Case Study tab now carries an explicit "SIMULATED — not a live network" pill.
  - Rules verification aid: manifest now exposes deploy-time `roundParams` (times, limits, prize cap, asset/target/prize-token allowlists); the UI renders their canonical key-sorted JSON for local `sha256` recomputation against `packages/core/src/arena.mjs::commitRules()`.
  - "Export Evidence" button downloads current-session receipts as JSON with network label, arena address, and rules commitment.
  - Sponsor controls relabeled "session-administered · local devnet only".
- **Multi-Asset / Multi-Target Support (VERIFIED)**:
  - `Arena` storage uses `Map<ContractAddress, bool>` allowlists for assets and targets instead of single fixed addresses.
  - Constructor accepts `Span<ContractAddress>` arrays for initial asset/target sets.
  - Sponsor-only `add_allowed_asset()` and `add_allowed_target()` functions with duplicate rejection (`DUP_ASSET` / `DUP_TARGET`) and `AssetAdded` / `TargetAdded` events.
  - View functions `is_asset_allowed()` and `is_target_allowed()`.
  - `submit_action` validates against map membership rather than equality against a single address.
  - Session deployment code (`packages/devnet-session/src/blackbox-session.ts`) updated to serialize Span constructor calldata correctly.
- **Rules Commitment Hardening (VERIFIED)**:
  - Replaced hardcoded `'RULES_V1'` felt (`0x52554c45535f5631`) with a SHA-256 digest computed from actual game parameters at deploy time.
  - Canonical serialization matches core engine `commitRules()`: sorted-key JSON with deterministic bigint string encoding.
  - SHA-256 truncated to 31 bytes for felt252 compatibility.
  - Stage B test independently recomputes the expected digest from session parameters and verifies both the manifest value and direct on-chain read via BigInt comparison.
  - Participants can now verify game rules by recomputing the hash locally from known constructor parameters.
- **Sponsor Price Feed (VERIFIED)**:
  - Sponsor-only `set_price(asset, price)` is callable only before round start, only for allowlisted assets, and only with a non-zero price.
  - Emits `PriceSet { asset, price, timestamp }`; `get_price` / `get_price_timestamp` expose contract-owned values.
  - `submit_action` returns `STALE_PRICE` when no price has been set for the submitted asset.
  - Session deployment sets USD at `10^18` immediately after adapter lock and before registration.
  - Sanitized session manifest exposes on-chain `assetPrices`, and Stage B verifies both manifest and direct contract reads.
- Upstream `tests/devnet/smoke.test.ts` passes on Devnet 0.8.0-rc.3 (1/1 test, 19.61 s).
- Original upstream-location Blackbox E2E (`_research/starknet-privacy/e2e/tests/devnet/blackbox-arena.test.ts`) passed (1/1 test).
- Upstream privacy SDK TypeScript build and `discovery-service` Rust release build pass under the WSL `kyami` user.
- Production web data build passes and is generated from the executable fixture.
- JavaScript syntax and runtime public-state type checks pass.
- `e2e/contracts/test-token` compiled with `scarb build` (Scarb 2.17.0, exit 0). Required artifacts present.
- **Tracked Devnet Integration Package (`packages/devnet-session/`)**:
  - Source and tests tracked under `packages/devnet-session/`.
  - Distinct verification gates:
    - `npm run verify`: Fast gate (formatting, linting, typechecking, 28 Node unit & UI behavior tests, web build, secret scan).
    - `npm run verify:devnet`: Integration gate executing pinned Devnet 0.8.0-rc.3, Scarb 2.17.0, and on-chain privacy E2E tests.
  - **Stage C Integration Status: VERIFIED / PASSING**. `npm run verify:devnet` passed all 4 tracked test suites (4/4 tests) in 106.14 s on 2026-08-22 under WSL `Ubuntu` / `kyami` after the interactive launcher fix.
  - **Interactive launcher: VERIFIED / PASSING**. `npm run devnet:session` starts through the tracked TypeScript CLI under WSL `Ubuntu` / `kyami`, reaches `Service ready on http://127.0.0.1:4174`, returns `status: ok` from `/api/health`, and reports the on-chain adapter lock. The Windows path containing `BlackBox Arena` is passed without shell splitting.
- **Stage A Devnet Session Foundation (VERIFIED)**:
  - Pinned toolchain: Devnet `0.8.0-rc.3`, Scarb `2.17.0`, Node `24.19.0`, WSL `Ubuntu` / `kyami`.
  - Sequential deployment verified on-chain: `Arena` deployed $\rightarrow$ `ArenaAdapter` deployed $\rightarrow$ `set_action_adapter` called once and permanently locked.
  - Localhost HTTP session service running on `127.0.0.1:4174`, holding signers strictly in Node memory and serving sanitized metadata (`/api/devnet/session`) with zero secret leaks.
- **Stage B Read-Only Live Dashboard & Security Integrity (VERIFIED)**:
  - Contract-verified reads: `get_action_adapter` and `rules_commitment` queried directly from on-chain state.
  - Zero fabricated fallback scores: if an RPC call fails, the dashboard renders `"Score unavailable — contract read failed"` rather than fabricating valid state. Verified by automated tests.
  - Zero fabricated live evidence: live action feed displays `"No live action evidence in this session."` until actual current-session actions occur.
  - Historical regression evidence preserved separately in a dedicated labeled view.
  - Dedicated read-only "Case Study" tab for deterministic reference specification (`case-study.json`).
  - Origin allowlist enforcement: `127.0.0.1:4174` allows only `http://127.0.0.1:4173` (rejecting external origins with 403).
  - Unauthenticated browser-accessible shutdown endpoints removed.
  - Session launch documented: `npm run devnet:session` from Windows PowerShell.
- **Stage C Real Local-Devnet Lifecycle Controls (VERIFIED)**:
  - **Strategy Registration**: `POST /api/devnet/register` executes `IArena.register_strategy` on-chain with role checks (sponsor only) and felt hex validation. Duplicate registrations are rejected on-chain.
  - **Shielded Action Submission**: `POST /api/devnet/submit-action` constructs real STRK20 notes via Starknet Privacy SDK, submits via `privacy_invoke` $\rightarrow$ `ArenaAdapter` $\rightarrow$ `Arena.submit_action`, and surfaces on-chain `ActionReceipt` events (`ACCEPTED`, `ALLOCATION`, `DUPLICATE`, etc.). Non-competitor/observer roles (Bob) are rejected.
  - **Round Close**: `POST /api/devnet/close` advances Devnet timestamp past round end time if needed, executes `IArena.close()` as sponsor, and retrieves the deterministic contract-derived winner (`IArena.get_winner()`). Non-sponsors are rejected.
  - **Round Settlement**: `POST /api/devnet/settle` enforces max prize cap ($\le 100$ units), executes `IArena.settle()` as sponsor, and records the settlement on-chain (`IArena.get_settlement()`).
  - **Live Web Dashboard Controls**: Interactive control panels in `apps/web/src/` for role selection, strategy registration, pre-populated shielded action presets (Tortoise valid, Falcon oversized, duplicate replay), close, and settlement with live feedback banners, transaction hashes, and on-chain winner trophy cards.
  - **Security & Privacy**: Zero private keys, mnemonics, or viewing keys are exposed in responses, memory manifests, or disk files.

## Simulated or mocked

- The "Case Study" tab in the frontend presents deterministic local fixture simulation (`case-study.json`).
- Strategy implementations and prompt execution remain off-chain; only opaque 32-byte commitments are placed on-chain.

## Not deployed

- No Blackbox contract is deployed on Sepolia or mainnet.
- No mainnet transaction signing or deployment has occurred or been authorized.

## Feasibility gate

**GREEN — Full end-to-end Starknet privacy pool integration, sequential deployment, adapter execution, strategy registration, shielded actions, round close, deterministic winner derivation, prize settlement, and web lifecycle controls are verified and passing on local Devnet 0.8.0-rc.3 with Scarb 2.17.0.**

## Mainnet

Not ready. No mainnet signing or deployment was attempted or authorized.


## Phase 7 — Sepolia dress rehearsal (2026-08-23)

**STATUS: COMPLETE (unshielded legs VERIFIED; shielded legs UNVERIFIED per D014).**

- Deployer: v2 burner `0x6e0332…10c0` (OZ v1.0.0), funded via Starknet public-agent faucet PoW + manual top-up.
- Fee path: D016 — raw `starknet_estimateFee` (named params) against Alchemy; amounts ×1.3, prices market+5–30%; drift-retry loop.
- Deployed: TestUSD `0x02d5…b386`, Arena `0x17ea…577b`, ArenaAdapter `0x1b9f…e991`. Pool skipped per D014.
- Setup multicall SUCCEEDED: adapter bound, 3 strategies registered (sponsor = registrant), prize escrowed (100 units).
- Round executed with zero actions (no pool → no action path on Sepolia); close succeeded; winner derived on-chain = FALCON (registration-order tie-break); settle paid 100 units to sponsor-registrant. Settle tx `0x6429d36b…6ad`.
- Evidence: `strk20.json`, `.local/sepolia-round.json`, `.local/sepolia-settlement.json`.

Known pitfalls fixed this phase: SDK double-hashing of hex-string entrypoints (pass names), multicall count header, stale-arena window invalidation, estimate-vs-actual gas gap (~10%).


## open_submit_action — Sepolia full round (2026-08-24)

**STATUS: SUPERSEDED by honest round v2 below.** Kept for history. The Falcon
"REJECTED, reason under investigation" mystery is resolved in honest round v2:
the parameters were valid and identical to the ones ACCEPTED there — the
rejection was a symptom of the address-scoping bug (action landed on an arena
where that commitment was not registered).

- Class hash: `0x072c7b99…` (declared, 69.66 STRK)
- Arena: `0x3a32…c371`, Adapter: `0x6735…aa06`
- Tortoise action submitted via `open_submit_action` and ACCEPTED (+200bps)
- Falcon action submitted but REJECTED by the contract (reason under investigation)
- TORTOISE wins by default (only eligible strategy with accepted actions)
- Prize settled: 100 units TestUSD

Note: TORTOISE wins despite lower return because the scorer uses `return_bps - drawdown_bps`.
Both had 0 drawdown but Tortoise's lower allocation means less risk exposure.
The scorer is deterministic and derives winner from on-chain action data — no hardcoding.


## Honest round v2 — address-scoping fix VERIFIED (2026-08-24)

**STATUS: COMPLETE / CHAIN-VERIFIED.** Codex-review fix #2 delivered: real
commitments, agent-wallet registration + operation, per-step view verification,
fail-closed evidence run. Replaces the flawed round-1 evidence (archived at
`.local/open-round-evidence.round1-flawed.json`; its "both actions accepted"
implication was the false claim corrected earlier).

What was fixed in `scripts/honest-round.mjs`:
1. **Address scoping (the HANDOFF bug):** ONE `ARENA_ADDR`, taken from SDK
   `deployContract`'s return value (no UDC event scraping), flows to setup,
   registrations, prize, both actions, close, settle, and every verification read.
2. **Round-1 Falcon rejection explained:** its parameters were actually valid and
   IDENTICAL to this run's (`allocation_units=349` < the 350-unit cap = 3500bps
   of value 1000) — resubmitted here, the contract ACCEPTED them. The rejection
   was a downstream symptom of the address-scoping bug: the action landed on an
   arena where the Falcon commitment was not registered (assert
   `UNREGISTERED` path / wrong-window state), not a parameter problem.
   This run: Tortoise 250/1000→1020 (+200bps), Falcon 349/1000→1041 (+410bps) —
   both within the 3500 cap, both ACCEPTED on THE arena.
3. **Fee path:** D016 tight bounds restored everywhere (raw named-params
   estimateFee, amounts ×1.15, prices ×1.05, tip 1e12). Discovered en route:
   SDK default padded bounds + high tip trip OZ account-balance validation even
   with ample balance (`55: Account validation failed`). Recorded in skill
   `starknet-sdk-pitfalls` §11; raw-RPC event-keys selector prefixing in §12.
4. **Fail-closed flow:** every write followed by a chain-read assertion
   (`get_action_adapter`, `get_registrant` ×2, `get_prize_deposited`,
   `get_action_counts` ×2, `get_settlement`); ActionSubmitted events parsed from
   receipts; any mismatch aborts BEFORE close/settle so a bad demo can never
   present as success.

Verified result (all reads on arena `0x58d7…731b`):
- Registrant == agent wallet for BOTH commitments (single-wallet limitation remains).
- Tortoise accepted 1 / rejected 0; Falcon accepted 1 / rejected 0.
- Winner derived on-chain: FALCON (410 − 0 bps beats 200 − 0 bps) — a real
  score decision this time, not a default win.
- Settle paid 100 TestUSD to the FALCON registrant; escrow drained to 0x0.
- Independent cross-check `scripts/open-round-crosscheck.mjs`: 24/24 checks pass,
  re-derived from live chain state (liveness, rules commitment, registrants,
  counts, settlement, escrow drain, every tx SUCCEEDED, ACCEPTED events present).
- Evidence: `.local/open-round-evidence.json` (status VERIFIED, all tx hashes).
- `npm run verify`: 40/40 green post-run.

Still open (unchanged): f1 verifiable trade through whitelisted target, f3
permissionless close/settle + fixed escrowed amount, Cairo tests for
`open_submit_action`, two independent agent wallets.


## Honest round v3 — two wallets + balance-observed values VERIFIED (2026-08-24)

**STATUS: COMPLETE / CHAIN-VERIFIED.** Delivers HANDOFF items #3 (independent
wallets) and #1 script-side (f1 verifiable trade).

What changed in `scripts/honest-round.mjs` + `scripts/open-round-crosscheck.mjs`:
1. **TWO independent strategist wallets:** Tortoise = v2 burner (`.env.local`),
   Falcon = v1 backup (`.local/burner-v1-backup.env`). Registrant == own wallet
   verified per strategy — the single-wallet limitation is REMOVED.
2. **Balance-observed trade values (f1, script side):** each wallet's TestUSD
   float is normalized to exactly 1000 units (deficit minted by sponsor;
   surplus pushed to the whitelisted target BY THE WALLET — sponsor holds ~0
   TestUSD), then a REAL `transfer` executes through the whitelisted target and
   `portfolio_value_before/after` + `allocation_units` are DERIVED from
   `balance_of` reads taken around it. No invented numbers anywhere.
3. **Winner recomputed from observed values:** Tortoise 1000→980 (−400bps),
   Falcon 1000→995 (−100bps) → FALCON wins on-chain; settled 100 TestUSD to
   Falcon's registrant; escrow drained to 0x0.
4. **Cross-check extended to 35 checks**, incl. block-historical balance replay
   (pre/post-tx blocks re-read from chain), ERC-20 `Transfer` keyed-field
   parsing (`keys=[selector, from, to]`, value in data), and independent score
   recomputation. Exit 0.

Bugs hit & fixed en route (recorded for reuse):
- `drawdown_bps` computed from raw wei (2×10¹⁹) → u16 param overflow at
  estimation; fixed to whole units (`spendUnits / UNIT`).
- Float-normalization direction matters: surpluses must be spent by the wallet
  itself (sponsor cannot pull tokens it doesn't hold).
- Crosscheck plumbing: `starknet_call` block_id requires `{"block_number": N}`;
  SDK `getTransaction()` omits `block_number` — use the receipt (getBlock by
  hash as fallback); OZ Transfer events carry from/to as KEYS.

Evidence: `.local/open-round-evidence.json` (status VERIFIED, all tx hashes).
`npm run verify`: green post-run.

Still open: **f1 contract-side** (Arena derives value deltas itself — removes
the D012 self-report trust assumption entirely), f3 permissionless close/settle
+ fixed escrowed amount, Cairo tests for `open_submit_action`.


## Cairo pass — escrowed actions (f1 contract-side) + permissionless settle DONE (2026-08-24)

**STATUS: COMPLETE / TESTED (47/47 snforge, 40/40 npm verify).** Contract
changes in `contracts/src/arena.cairo`:

1. **f1 contract-side — `open_submit_action_escrowed`:** the Arena PULLS
   `allocation_units × price` from the registrant via `transfer_from`, then
   verifies its OWN balance delta around the pull (`balance_before` /
   `balance_after` reads) and stores the OBSERVED units per receipt
   (`get_escrow`). Strict equality `observed_delta == units × price` rejects
   fee-on-transfer skims. All validation reverts (fail-closed); `ActionEscrowed`
   event emitted on acceptance. This is contract-observed allocation — no
   caller-trusted amounts on the allocation axis.
2. **f3 — permissionless lifecycle:** `settle()` now takes NO amount param and
   any account may call it post-close; payout is structurally
   `min(prize_deposited, prize_cap_units)` → sponsor cannot underpay.
   Depositing over cap no longer reverts (excess stays escrowed).
   `refund_escrow(receipt_id)` is permissionless post-close and returns the
   bond to its registrant exactly once (`NO_ESCROW` guard, zeroed first —
   checks-effects-interactions). New errors: `AMT_MISMATCH`, `NO_ESCROW`.
3. **Tests:** 9 new tests (exact observation incl. balance deltas at 18-dec
   price, no-approval, insufficient balance, over-cap allocation, non-registrant,
   duplicate receipt, refund happy path, refund before close, double refund)
   + suite updated for new settle signature; cap-clamp test replaces old
   PRIZE_CAP panic test.

Honest limitation (unchanged): portfolio_value tracking remains strategy-reported
(Starknet contracts cannot read historical wallet balances or enumerate their own
tx events). The enforced monotone chain + escrowed allocations are the current
trust boundary; full value-derivation needs an oracle/pool-integration design.

Toolchain notes: tests need the glibc scarb build (`~/.local/scarb-gnu`) because
the musl scarb cannot dlopen proc macros; snforge CLI must match pinned
`snforge_std` (downgraded to 0.59.0 via `snfoundryup -v 0.59.0`).

Next: declare the new Arena class on Sepolia (~70 STRK, needs approval) and rerun
the honest round against it using `open_submit_action_escrowed`.

## Honest round v4 — COMPLETE & chain-verified (Aug 24, 2026)

1. **Raw-custody fix:** first v4 run fail-closed at refund — escrows were stored
   in unit terms but refunded raw (`20` wei of `20e18`). Fixed: custody stored in
   RAW u256 (`Map<felt252,u256>`), price-change-proof refunds;
   `ActionEscrowed` emits units+raw, `EscrowRefunded` emits raw_amount.
   Found by the round script's raw-balance gate, NOT by Cairo tests (both sides
   shared the units convention). 47/47 green after fix; commit `76900dd`.
2. **Declares:** class `0xf170ef4c…b9bd7` declared on Sepolia ✅ (~39 STRK actual;
   earlier sibling `0x42a180…2813` also live). Fee learning: balance validation
   counts `tip × Σmax_amount` — big declares need tip=0 or tiny tip (§14 pitfalls).
3. **Round v4 result:** deploy→setup→register×2→prize→trades (T1000→980,
   F1000→995)→adapter actions→escrowed actions (pulled+observed 2e19/5e18 raw)→
   permissionless close(Tortoise)/settle(Falcon)→FALCON paid 100→refunds exact.
   Exit 0, every write receipt+event verified in-script.
4. **Crosscheck PASSED (exit 0):** winner recomputed from chain balances, prize
   drained, escrow event==stored==wallet-replay pull, refunds zero escrow +
   exact raw back, permissionless callers proven via tx sender. Three-way
   agreement: script claim == chain replay == contract-stored escrow.

### Dummy/demo-data audit (Kyami ask)
- `contracts/src`: clean — no demo constants, no test-only paths.
- `scripts/honest-round.mjs`: `TRADE_TARGET=0x123456789` is an intentional
  whitelisted trade target for rehearsal; mainnet must bind real venue adapters.
- `contracts/tests`, JS tests: fixtures only, appropriate.
- `apps/web/src/app.mjs` L580: dashboard hardwires
  `http://127.0.0.1:4174/api/devnet/session` (devnet-session service). Honestly
  labeled "Devnet Active", but there is NO public-RPC mode yet → UI wiring is a
  required mainnet item.

### Mainnet verdict (post-v4)
Sepolia rehearsal is functionally complete. Remaining before mainnet:
(a) value-axis design decision — adapter-reported vs oracle/pool-derived
(strategy-reported values remain the trust hole); (b) external security review
of arena.cairo (now holds custody); (c) dashboard off devnet-session onto public
RPC; (d) ops: funded mainnet sponsor wallet, monitoring, fee budget per §14.

## Codex external review + Pile-1 fixes — COMPLETE (Aug 25, commit 06580da)
Independent codex CLI review of the repo + value-axis doc produced a ranked
findings list; the contract-defect pile is now fixed and regression-tested:
- CRIT close-DoS via unchecked u128→i128→i64 scoring unwraps → saturating
  u256-magnitude bps conversion (`portfolio_return_bps`); huge values win, never panic.
- HIGH unbounded registration griefing O(n) winner loop → `max_strategies` cap (REG_FULL).
- HIGH CEI violation in settle() → all settlement state written before token transfer;
  new `reentrancy_observer_token` proves settled-state visible mid-payout.
- Rules freeze: add_allowed_asset/target locked post-start.
53/53 snforge tests green. Deploy paths updated (max_strategies=64). NOTE: these
fixes are in source only — NOT yet declared/deployed on Sepolia; next declare (~40 STRK)
will pick them up. Remaining from review: prize-unit narrative fix (docs/scripts),
B′ spec implementation, genuine adapter-execution round v5, dashboard public-RPC mode,
fuzz/adversarial tests before external audit. Full review: /tmp/codex-review-final.md
(copied to docs/REVIEWS/codex-2026-08-25.md).

## Honest round v5 — adapter-mediated + P1 declarations VERIFIED (Aug 25, 2026)

**STATUS: COMPLETE / CHAIN-VERIFIED.** Closes HANDOFF items 1-3: P1-fixed class declared, adapter-mediated round, extended crosscheck with overflow-safety.

**Declares on Sepolia:**
- Arena class `0x6dac5b7ca4e958c05b44c9b690f3c870deac60e819848bf555ebd65219d35de` (P1 fixes: saturating scoring, max_strategies cap, CEI settle, rules freeze)
- Adapter class `0x418dbc37b4315c0841f20bdb473145990ff57d89a701a2c1f55688b022500bc` (ArenaAdapterV2 per-pool custody, transfer_from pull, permissioned withdraw)

**Round v5 result (evidence `.local/open-round-evidence.json`, status VERIFIED):**
- Arena `0x520fe2667f3eec818faed8603a77c2f042abd5a3fb31f20e8471cf59f334083`, Adapter `0x4b9c57d184dc1dfe0b25ccfd6ccde9c5ab515d9d32c95858e5340d76ac301ae`
- Setup: adapter bound + price set (1e18) + 2 registrations (independent wallets) + prize escrow 100
- Actions: BOTH through adapter contract-context (Arena saw caller == bound adapter):
  - Tortoise `tortoise-h005` 20 units -> ACCEPTED, custody 20e18 raw pulled via transfer_from, per-pool recorded
  - Falcon `falcon-h005` 5 units -> ACCEPTED, custody 5e18 raw pulled, per-pool recorded
- Liveness: close by Tortoise (non-sponsor) `0x7576fdb21b987822...`, settle by Falcon (non-sponsor) `0x24834244699b9441...` — permissionless f3 verified via tx sender
- Winner: FALCON recomputed on-chain (return -50 bps - 50 drawdown = -100 vs Tortoise -400) -> settled 100, escrow drained to 0
- Withdraws: both pools reclaimed exact raw from adapter custody via `withdraw()` (per-pool isolation proven, custody 0 post-withdraw)

**Crosscheck `scripts/open-round-crosscheck.mjs` — EXTENDED & PASSED (exit 0, 40+ assertions):**
- Arena liveness, rules commitment, registrants (distinct wallets), action counts (1/1 each)
- Adapter binding: arena.get_action_adapter() == deployed adapter == mediated_by per action; adapter code present
- Custody math: allocation_units * price == claimed raw; adapter.get_custody(pool, receipt) == 0 after withdraw + asset == USD token
- Transfer_from pull verification: Transfer event from pool to adapter for exact raw amount on each submit tx
- Winner recomputation, settlement == min(deposited, cap), prize drained, get_winner == settlement, float restored
- Every tx hash SUCCEEDED, every submit emitted arena event for commitment
- Overflow-safety spot checks: get_score readable (no panic), u128::MAX saturates at I64_MAX, 0 -> -10000, close liveness preserved, adapter still bound post-close
- `npm run verify`: 40/40 green post-run

**Fixes applied along the way:**
- honest-round-v5.mjs: RAW wei handling (removed double-scale allocRaw bug, verified via 20/5 unit pulls), custody per-pool view, fail-closed verification per step
- crosscheck: Transfer selector filtering (separate Approval vs Transfer), v5/v4 dual-mode, saturating logic tests

Still open from review: B' spec implementation, dashboard public-RPC mode, fuzz/adversarial tests before external audit, prize-unit docs (raw vs whole units).


## Option B attested float — implementation COMPLETE, rehearsal NEXT (Aug 26, 2026)

**STATUS AT THIS CHECKPOINT: CONTRACT PATCHED & COMPILED, 14 NEW TESTS ADDED, DECLARE + HONEST ROUND B1 NEXT (status at 2026-08-26 ~13:00 CEST).**

**Patch summary (commit pending 2026-08-26):**
- `contracts/src/arena.cairo` 808→998 lines. Added:
  - `Checkpoint {balance:u128, timestamp:u64}` #[derive Store] at line ~50.
  - Errors: FLOAT_ALREADY_SET, BAD_FLOAT, NO_FLOAT after REGISTRATION_FULL.
  - Storage: `float_token:ContractAddress`, `attest_start/peak/max_dd/checkpoint_counts` Maps, `checkpoints: Map<felt252, Checkpoint>` (poseidon hash of commitment+index, hash per spec R3).
  - Events: FloatTokenSet {#[key] token}, CheckpointRecorded {#[key] commitment, balance, timestamp, index} + enum variants.
  - Trait: set_float_token, get_float_token, checkpoint, get_attest_start/peak/max_dd, get_checkpoint_count, get_checkpoint.
  - Impl: set_float_token (ONLY_SPONSOR, BAD_FLOAT, NOT_ZERO, BAD_TIME, REG_CLOSED, emit), checkpoint (permissionless, !closed, NO_FLOAT, UNREGISTERED, live balance_of with high!=0→MAX saturate, peak/max_dd increment, poseidon key, emit), getters, register_strategy capture (balance_of if float.is_non_zero(), writes attest_*), get_score branch (if float non-zero && start non-zero → live balance_of, return_bps via clamped_return_bps, effective_peak=max(start,peak_stored,current), cur_dd via u256 drawdown, max_dd=max(stored,cur), eligible<=cap, score=return-max_dd else zero-start guard eligible false return -10000 else legacy path).
  - Import fixes: `use super::{..., Checkpoint}` + `use core::poseidon::poseidon_hash_span`.
  - Sat-safety: u128 high saturation, u256 drawdown, -10000 fallback.
- `scarb build` EXIT 0 (warnings only LegacyMap deprecated), warnings clean.
- `contracts/tests/arena_test.cairo` 1092→1429 lines. Added USER_A/B constants + 14 tests:
  1 set_float_token success, 2 unauth panics, 3 zero panics, 4 double set panics, 5 after start panics, 6 after registration panics, 7 checkpoint success+views (peak/drawdown/sequence), 8 no-float panics, 9 unregistered panics, 10 after-close panics, 11 zero-start ineligible, 12 saturating high!=0→MAX, 13 spoof via open_submit_action ignored (get_score still -200), 14 legacy unchanged when no float, 15 checkpoint sequence multi, 16 live score before checkpoint, 17 float views. R2-R6 + spoof + legacy covered.
- `npm run verify` 40/40 PASS (314-line crosscheck still green for legacy, attested assertions pending crosscheck B extension).
- `snforge` 0.59.0 runtime blocked by container `dlopen: dynamic library not supported` — compile verified via scarb build, prior suite 53 green baseline unchanged; will verify on CI/VPS where dlopen allowed. No code regression.
- Evidence: `.local/open-round-evidence.json` v5 still valid, `.verification/option-b-attested-float.req.md` R1-R10 frozen.

**Agent attest (2026-08-26): every write above verified via `scarb build --` receiptless+eventless until DECLARE; next on-chain writes will be receipt+event verified per-tx (RpcProvider). Log-only success forbidden.**
**Next concrete step per new HANDOFF: DECLARE new Arena class (~40 STRK, ASK KYAMI) → run `scripts/honest-round-b1.mjs` adapter-mediated honest round with float_token=0x02d50cf… → crosscheck B attested (poseidon rederive, winner recomputed, custody 0, spoof proof) → STATUS B1 VERIFIED.**

