# Existing BlackBox reuse map

## Non-negotiable principle

BlackBox Studio is the self-service interface and orchestration layer for the
BlackBox Protocol that already exists in this repository.

Do not build another BlackBox Protocol.

The existing contracts, SDK semantics, Mainnet class hashes, wallet findings,
and verified transaction flow are the source of truth. Studio adds dynamic
configuration, deployment orchestration, dashboards, issuance selection, and
policy-specific holder experiences around them.

## Existing contracts to reuse

Read these files; do not replace or modify them without explicit owner approval:

| Component | Source |
|---|---|
| CapabilityGatekeeper | `contracts/src/capability_gatekeeper.cairo` |
| CapabilityToken | `contracts/src/capability_token.cairo` |
| TreasurySpendAdapter | `contracts/src/treasury_spend_adapter.cairo` |
| Test-only target | `contracts/src/mock_capability_target.cairo` |
| Cairo package/toolchain | `contracts/Scarb.toml` |

These contracts already implement:

- configured privacy-pool authentication;
- current-transaction capability delivery markers;
- stale delivery and replay rejection;
- target and selector enforcement;
- optional first-argument cap enforcement;
- expiry and revocation checks;
- reusable return or one-shot consumption;
- fixed treasury, asset, and recipient semantics through the adapter;
- direct non-Gatekeeper adapter-call rejection.

Studio must not recreate those rules in JavaScript as the authority. UI
validation is guidance; Cairo remains enforcement.

## Existing SDK to reuse

| Resource | Source |
|---|---|
| Capability SDK implementation | `packages/capability-sdk/src/index.mjs` |
| SDK integration guide | `packages/capability-sdk/README.md` |
| SDK regression tests | `tests/capability-sdk.test.mjs` |

Before creating a Studio transaction builder, inventory and reuse the existing
SDK exports for:

- policy registration calls;
- public disclosure descriptions;
- holder capability actions;
- target selector and calldata construction;
- wallet-native STRK20 invocation inputs.

Studio may wrap these exports in user-oriented services. It must not fork their
logic silently. Phase 0 must choose one explicit dependency strategy:

1. consume the existing package through the repository package/workspace setup; or
2. copy a minimal, versioned browser adapter into Studio with source provenance
   and regression parity tests.

Do not use ad hoc relative imports that make the isolated Studio build depend on
untracked changes outside its folder.

## Existing wallet flows to study and reuse

| Flow | Source |
|---|---|
| Issuer connection, allowance, and native STRK20 issuance | `apps/web/src/issue.mjs` |
| Holder connection and capability use | `apps/web/src/holder-app.mjs` |
| Wallet discovery and privacy feature checks | `apps/web/src/wallet-operator.mjs` |
| Completed deployment/reconciliation logic | `apps/web/src/deploy.mjs` |
| Existing issuer interface states | `apps/web/src/issue.html` |
| Existing holder interface states | `apps/web/src/holder-app.html` |

Studio may copy proven logic into isolated Studio modules with attribution and
tests. It must not edit these existing sources.

Verified wallet lessons that must be preserved:

- a returned transaction hash means submitted, not successful;
- wait for and inspect the Mainnet receipt;
- Ready's ordinary invoke route dropped the SNIP-36 proof during testing;
- verified issuance used the wallet-native `strk20InvokeTransaction` route;
- read the current public pool fee instead of hard-coding the observed value;
- pool fee allowance, capability-token allowance, and treasury allowance are
  separate concepts;
- wallet cancellation and partial completion require recoverable states;
- do not expose note plaintext, viewing keys, or wallet logs.

## Existing artifacts and configuration

| Resource | Source |
|---|---|
| Verified reference configuration | `configs/mainnet-demo.json` |
| Hackathon Mainnet metadata | `strk20.json` |
| Generated Sierra/CASM artifacts | `contracts/target/dev/` |
| Mainnet and wallet evidence | `docs/NETWORKS.md` |
| Current verified progress | `docs/STATUS.md` |
| Durable architecture decisions | `docs/DECISIONS.md` |
| Product flow explanation | `docs/PRODUCT-FLOW.md` |

Generated artifacts are build outputs. Studio should reuse declared class hashes
after verifying them against the source/artifact build; it must not compile a
different contract and assume compatibility.

## Verified Mainnet classes and reference instances

Reference deployed instances:

| Component | Address |
|---|---|
| CapabilityGatekeeper | `0x01126ea67555e0d82c51efe0352f9cf99aec81b7af40ff9c3dab4ccced5b8ff8` |
| TreasurySpendAdapter | `0x021a77531446c9a0e581e4199d9296d00fe45d279c631d0d0ab16cc66340afd7` |
| CapabilityToken | `0x0567bbe5adafeb5920849c695f158bb3d287c702396fa1f87eb9e4978e39b11d` |

Declared class hashes:

| Class | Hash |
|---|---|
| CapabilityGatekeeper | `0x62b8b737e10c4b06727e9ef672fc0163f8331388e812a249f28cc9edaa63efe` |
| CapabilityToken | `0x408fa2fde6f253b3771c43181c8eb8c7f5f71a929c4bd74cb0b25852e5a17e7` |
| TreasurySpendAdapter | `0x7617280a31c7ffbf16b5eb18e7f783d1953d295277b293eb816b304041a3da0` |

Configured Mainnet STRK20 pool:

`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

Reference instances prove the flow. Studio-created mandates should deploy new
instances from the existing declared classes rather than mutate the reference
policy.

## Verified transactions to preserve as evidence

- private-pass issuance:
  `0x26a63750cb24beb38cc4eb8a976d04458c9015331b63be89a71c309a2b8e589`
- holder exercise:
  `0x7978bc0e9292a86c9e01411784dd6ec3db117e967a2ec08a2131844579d1386`

These hashes are evidence, not fixtures for fake Studio history. Studio must not
show them as belonging to a newly connected organization.

## What Studio should build

Studio-specific work includes:

- user-first application shell;
- Treasury Mandate configuration wizard;
- deterministic normalization and validation;
- deployment planning around existing class hashes;
- wallet-reviewed instance deployment and setup orchestration;
- receipt/state reconciliation and recovery;
- public organization policy dashboard;
- real public activity history;
- dynamic policy selection for issuance;
- policy-specific holder links and holder states;
- exports and integration guidance.

## What Studio must not build

- replacement capability contracts;
- a second Gatekeeper design;
- a second capability token standard;
- a new privacy pool;
- a custom proof system;
- a fake private-note database;
- a parallel SDK with different policy semantics;
- an arbitrary-call permission engine;
- modified versions of the verified reference contracts without approval.

## Phase 0 required output

Before UI code, Phase 0 must produce Studio-local documentation containing:

1. exact constructor parameters read from existing Cairo;
2. SDK export inventory and selected dependency strategy;
3. exact instance deployment and setup sequence;
4. field-to-contract-enforcement map;
5. class-hash verification method;
6. copied-module provenance list, if copying is chosen;
7. gaps that truly require new code;
8. confirmation that no replacement protocol is being designed.
