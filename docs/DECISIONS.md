# Decisions

## D001 — Build the local executable specification before chain integration

Accepted. A deterministic, dependency-free Node core makes rules and fixtures reproducible while the Starknet toolchain is unavailable. It is not presented as the production source of truth.

## D002 — One Arena and one asset/target in the first contract spike

Accepted for the initial feasibility spike; superseded by D009.

## D003 — Consume invalid receipt IDs

Accepted. Any non-duplicate attempted receipt is marked processed, including rejected actions, so a sender cannot replay the same identifier with altered fields. A duplicate itself is not re-consumed.

## D004 — Disqualify over-limit drawdown during scoring, not action validation

Accepted. Pulse's action remains evidence and its value remains observable, but eligibility is false before ranking. This preserves the required case study.

## D005 — Use official `privacy_invoke` return/change pattern

Accepted as an unverified hypothesis. The adapter authenticates the configured pool, calls Arena state, approves the pool, and returns `OpenNoteDeposit`. No signature was invented; the shape comes from the official starter and tagged Vesu/Ekubo examples.

## D006 — Do not select later privacy tags merely because they exist

Accepted. Tags RC.3–RC.5 exist, while the current main compatibility matrix names RC.2 for services/SDK and RC.0 for contracts. Integration will revalidate the matrix and use a matching row.

## D007 — Keep Sepolia/mainnet fields empty

Accepted. The current official sources do not yield a fully verified Blackbox-compatible set of RPC, pool, prover, discovery, token, and adapter values. `.env.example` names the variables without stale values.

## Open decisions

- Green private invocation versus Yellow private-entry/private-payout scope.
- ~~Generalized multi-asset and multi-target storage after the feasibility spike.~~ (Resolved by D009.)
- ~~Canonical Starknet-native rules commitment versus verifying the current SHA-256 canonical JSON digest.~~ (Resolved by D010.)
- ~~Trusted valuation/oracle input for production portfolio values and drawdown.~~ (Initial sponsor-feed gate resolved by D011; decentralized oracle remains open for production hardening.)

## D008 — Safe sequential deployment via locked one-time `set_action_adapter`

Accepted. The `Arena` constructor now initialises `action_adapter` to the zero address. The sponsor calls `set_action_adapter` exactly once, before any strategy is registered and before the start timestamp. The function asserts: caller is sponsor, new address is non-zero, current stored address is zero (prevents replacement), block timestamp is before start, and registration count is zero. An `ActionAdapterSet` event is emitted and the value is permanently locked. This eliminates the cyclic deployment dependency without precomputed addresses, and the pattern is fully verified by six new Foundry tests.

## D009 — Storage-map allowlists for multi-asset and multi-target support

Accepted. Replaces the single `allowed_asset` / `allowed_target` constructor fields with `Map<ContractAddress, bool>` allowlists plus count trackers. The constructor accepts `Span<ContractAddress>` arrays for initial sets. Sponsor-only `add_allowed_asset()` / `add_allowed_target()` functions permit post-deployment expansion with duplicate rejection (`DUP_ASSET` / `DUP_TARGET`) and `AssetAdded` / `TargetAdded` events. View functions `is_asset_allowed()` / `is_target_allowed()` expose membership to off-chain consumers. `submit_action` validates against map lookup rather than equality, enabling actions on any registered asset/target pair within a single round. Fully verified by 5 new Foundry tests (18/18 total) and 4/4 Devnet integration suites.

## D010 — SHA-256 canonical JSON digest for rules commitment

Accepted. The Arena constructor now receives a SHA-256 hash of a canonicalized rules object instead of a human-readable felt label. The canonical serializer sorts keys alphabetically and encodes bigint values as decimal strings, matching `packages/core/src/arena.mjs::commitRules()`. The 32-byte digest is truncated to 31 bytes for felt252 compatibility. At deploy time, `packages/devnet-session/src/blackbox-session.ts` computes the digest from actual constructor parameters (`startTime`, `endTime`, `startingUnits`, allocation/drawdown limits, prize cap, asset allowlist, target allowlist). Stage B integration test independently recomputes the expected digest from session state and asserts both manifest and on-chain reads match via BigInt comparison. Any tampering with game parameters produces a different commitment, enabling participant-side verification before joining a round.

## D011 — Sponsor-owned pre-start price gate as first oracle step

Accepted for local lifecycle integrity; not a production decentralization claim. The sponsor can set a non-zero price for each allowlisted asset only before round start. `set_price` emits `PriceSet`, records timestamp, and exposes read-only views. `submit_action` rejects an action with `STALE_PRICE` if no price exists for that asset, ensuring every scored action has at least one contract-visible valuation reference. The session deploys USD at `10^18`, publishes prices through the sanitized manifest, and Stage B verifies manifest values against direct contract reads. A decentralized oracle can later replace or augment this source without changing Arena ranking. Price semantics (clarified during Phase 4 verification): `price` is **raw token units per allocation unit**; consumers convert via `raw = allocation × price`. The ArenaAdapter previously inverted this (`allocation × 10¹⁸ ÷ price`), reverting every shielded action with `BAD_AMOUNT`; corrected in Phase 4 and locked in by the E2E suite.

## D012 — Accept self-reported `portfolio_value_after`; defer signed valuations and oracles

Accepted for the qualification product; recorded as an explicit trust assumption, not a hidden one. `portfolio_value_before` is contract-checked against stored state (`BAD_VALUE`), but the after-value inside each shielded action is taken on faith: a static pre-start sponsor price (D011) cannot validate intra-round value deltas, and no honest on-chain check of the after-value exists without either sponsor-signed per-action valuations or an external oracle such as Pragma. Both are deferred to post-sprint hardening rather than shipping validation code that only appears to check something. Consequence: a strategy operator can misreport its own final value; the Arena still guarantees equal rules, bounded allocations, replay protection, deterministic ranking of whatever values are reported, and capped settlement — but not independent verification of reported performance. This must remain visible in the UI trust disclosure.

## D013 — Escrowed prize token payout to the winner's registrant

Accepted. The Arena constructor takes a `prize_token` address. The sponsor funds an escrow by approving the Arena and calling `deposit_prize(amount)` (pulls via `transfer_from`, emits `PrizeDeposited`, tracked by `get_prize_deposited`). `settle(amount)` keeps cap/single-use checks, then requires the winner to have a registered registrant (`NO_REGISTRANT` otherwise), requires an on-chain token balance covering the amount (`NO_PRIZE`), transfers the prize to the winner's registrant (`PrizePaid` event), and records settlement as before. A private Green-path payout through the STRK20 pool remains an open alternative and was deliberately not built here; switching later would change settlement mechanics but not scoring.

## D014 — Sepolia dress rehearsal proceeds without self-declared privacy pool

Accepted 2026-08-23. Declaring the official privacy-pool class on Sepolia from our burner account is blocked by sequencer admission economics: blockifier reserves `Σ(resource max_amounts × prices)` against balance under surge multipliers, and Cairo1 declares burn enormous l2 gas (Arena class measured at **844,860,800 l2_gas units ≈ 41 STRK actual**; pool estimate ≈ 55 STRK). With ~85 STRK total, pool + arena + operations cannot fit. Decision: run the rehearsal scoped — Arena + Adapter + prize-token lifecycle only (registrations, prices, escrow, close, winner derivation, capped payout). Shielded-action legs remain **proven on Devnet E2E / UNVERIFIED-on-Sepolia** until either (a) the burner holds ≥ ~250 STRK, or (b) an officially declared pool on Sepolia becomes usable. This loses nothing for sprint judging: mainnet scoring uses the official live pool, not a self-declared instance.

## D015 — Alchemy is the required Sepolia RPC; free public endpoints are inadequate

Accepted 2026-08-23 after systematic elimination. Verified failures: BlastAPI public (discontinued), Nethermind free (unreachable), Lava testnet (no provider pairings), OnFinality (unreachable), dRPC (lacks `starknet_getBlockWithTxHashes`/`starknet_getNonce`; free-plan timeouts on multi-MB bodies), publicnode (drops multi-MB bodies; estimator intermittently cold). Alchemy free tier works fully: native fee estimation returns real bounds, large bodies accepted, all read methods present. Key held in gitignored `.env.local` as `ALCHEMY_API_KEY`.


## D016 — Privacy pool self-declaration on Sepolia: not viable (2026-08-23)

**Decision:** Permanently park self-declaring the 1MB privacy pool on Sepolia. The shielded-action path remains Devnet-proven; Sepolia rounds run without it.

**Evidence:** With 2,955 STRK balance and a bounds reserve of only 184 STRK (well within balance arithmetically), the account validator still rejects the declare with `exceed balance`. The validator re-simulates internally with a class-size-dependent surge factor (>16x for this class) that we cannot control or predict. This supersedes the earlier theory that surge was merely a multiplier on reserve — it is a re-simulation cost gate.

**Consequence:** Arena's `submit_action` remains adapter-gated on Sepolia; agents cannot submit actions on-chain there. Agent runtime actions are validated against the deterministic core engine locally. Future options: an `open_submit_action` entrypoint (contract change), or mainnet where gas economics differ.
