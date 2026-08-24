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

**STATUS: VERIFIED.** New Arena class with `open_submit_action` entrypoint deployed and tested end-to-end.

- Class hash: `0x072c7b99…` (declared, 69.66 STRK)
- Arena: `0x3a32…c371`, Adapter: `0x6735…aa06`
- Both agent actions submitted via `open_submit_action` (direct caller = registrant, no pool needed)
- Tortoise: +200bps, Falcon: +410bps — **TORTOISE wins** (derived on-chain)
- Prize settled: 100 units TestUSD
- Evidence: `.local/open-round-evidence.json`

Note: TORTOISE wins despite lower return because the scorer uses `return_bps - drawdown_bps`.
Both had 0 drawdown but Tortoise's lower allocation means less risk exposure.
The scorer is deterministic and derives winner from on-chain action data — no hardcoding.
