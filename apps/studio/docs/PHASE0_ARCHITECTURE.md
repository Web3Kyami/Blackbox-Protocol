# Phase 0 architecture — BlackBox Studio

**Status:** Phase 0 only. UI implementation is **not** authorized until this gate
is satisfied (see `IMPLEMENTATION_PLAN.md`).
**Scope:** read-only inventory of the existing BlackBox Protocol that Studio will
reuse. No file outside `apps/studio/` was modified to produce this document.
**Updated:** 2026-08-28

---

## 0. Confirmation of the non-replacement principle

Studio is a product and orchestration layer over the existing BlackBox Protocol.
It does **not** redefine or fork Gatekeeper, CapabilityToken, TreasurySpendAdapter,
or the SDK. Anything in this document is a description of the existing pieces
that Studio wraps, copies, or composes. If a Studio need cannot be met by the
existing pieces, Phase 0 records the gap here and pauses for owner approval
before any new code is written.

The proof that nothing is being replaced: every Cairo field, every SDK export,
every wallet-flow step referenced below is a direct quotation of an existing
file in the repository. No new Cairo is proposed. No new SDK is proposed.

---

## 1. Existing Cairo contracts — inventory

Source: `contracts/src/capability_gatekeeper.cairo`,
`contracts/src/capability_token.cairo`,
`contracts/src/treasury_spend_adapter.cairo`,
`contracts/src/lib.cairo`, `contracts/Scarb.toml`.

Studio must not modify these. Studio may read them and may copy proven
behaviour into a separate, isolated module under `apps/studio/src/` with
provenance (see §6).

### 1.1 CapabilityGatekeeper

- Module: `CapabilityGatekeeper` (in `capability_gatekeeper.cairo`).
- Constructor:
  `constructor(ref self, privacy_pool: ContractAddress)`.
- Public interface (`ICapabilityGatekeeper`):
  - `register_policy(capability_token, target, selector, enforce_first_arg_max, max_first_arg, expires_at, reusable)`.
  - `set_policy_active(capability_token, active)`.
  - `privacy_invoke(capability_token, target, selector, calldata, return_note_id)`.
  - `get_policy(capability_token) -> (issuer, target, selector, enforce_first_arg_max, max_first_arg, expires_at, reusable, active, uses)`.
  - `get_privacy_pool() -> ContractAddress`.
- Control interface (`ICapabilityTokenControl`) embedded in the same file is
  the Gatekeeper's view of the CapabilityToken.

Contract-enforced invariants Studio must respect (from the source):
- `register_policy` asserts: `capability_token != 0`, `target != 0`,
  `selector != 0`, `expires_at > now`, no prior policy exists for the token,
  caller equals the token's `get_issuer()`, token's `get_privacy_pool()` equals
  the Gatekeeper's pool, and token's `get_gatekeeper()` equals this contract.
- `privacy_invoke` is **only** callable by the configured privacy pool.
  It enforces target match, selector match, first-arg cap, expiry, active flag,
  reentrancy guard, then calls `target(selector, calldata)` via
  `call_contract_syscall`, increments uses, and either returns a one-unit
  open-note deposit (reusable) or burns the note (one-shot).
- The pool address is **immutable** after construction (single-write storage).

### 1.2 CapabilityToken

- Module: `CapabilityToken` (in `capability_token.cairo`).
- Constructor:
  `constructor(ref self, name, symbol, issuer, privacy_pool, gatekeeper)`.
- Public interface (`ICapabilityToken`):
  - ERC-20 surface: `name`, `symbol`, `decimals` (returns `0`),
    `total_supply`, `balance_of`, `allowance`, `transfer`, `transfer_from`,
    `approve`.
  - Issuer-only `mint(recipient, amount)`.
  - Gatekeeper-only `consume_pool_delivery(expected_amount)` and
    `burn_from_gatekeeper(amount)`.
  - Read views: `get_issuer`, `get_privacy_pool`, `get_gatekeeper`,
    `get_delivery() -> (tx_hash, amount, consumed)`.
- Delivery recording (the privacy primitive the existing product relies on):
  when a `transfer` moves units from `privacy_pool` to `gatekeeper`, the token
  records `tx_hash`, `amount` and resets `consumed = false`. The Gatekeeper
  then calls `consume_pool_delivery(expected_amount)` inside the same tx to
  mark the delivery consumed.

Contract-enforced invariants Studio must respect:
- The token's `privacy_pool` and `gatekeeper` are set once at construction and
  never updated.
- A delivery is consumed only if its `tx_hash` matches the current
  `tx_info.transaction_hash` (this is what makes the pool route replay-safe
  for the same transaction).
- `mint` is callable only by `issuer`; `consume_pool_delivery` and
  `burn_from_gatekeeper` are callable only by `gatekeeper`.
- Decimals is fixed at `0` — a "unit" is the smallest transferable amount.

### 1.3 TreasurySpendAdapter

- Module: `TreasurySpendAdapter` (in `treasury_spend_adapter.cairo`).
- Constructor:
  `constructor(ref self, gatekeeper, treasury, token, recipient)`.
- Public interface (`ITreasurySpendAdapter`):
  - `spend(amount: u128)` (Gatekeeper-only).
  - `get_config() -> (gatekeeper, treasury, token, recipient)`.
  - `get_total_spent() -> u256`.
- The adapter calls `IERC20TransferFrom(token).transfer_from(treasury,
  recipient, amount)`. The treasury must therefore `approve` the adapter for
  at least one maximum payout before any exercise.

Contract-enforced invariants Studio must respect:
- `gatekeeper`, `treasury`, `token`, `recipient` are immutable after
  construction.
- `spend` is callable only by the configured Gatekeeper.
- The selector the holder invokes is fixed at
  `selector!("spend")` (Cairo short-string `"spend"` → a `felt252` selector).
  The Gatekeeper `register_policy` call passes
  `selector = hash.getSelectorFromName("spend")` on the JS side.
- A successful `spend` is a public `TreasurySpent` event with `treasury`,
  `token`, `recipient`, `amount`, `total_spent`.

### 1.4 Other modules in `contracts/src/`

`lib.cairo` exposes additional modules: `arena`, `arena_adapter`,
`arena_adapter_v2`, `mock_capability_target`, `mock_prize_token`,
`reentrancy_observer_token`. These are **Arena-specific** and are **not**
part of the Treasury Mandate path. Studio must not import or copy them for
the Treasury Mandate template.

### 1.5 Class hashes (declared on Mainnet)

Source: `REUSE_MAP.md`, `docs/NETWORKS.md`, `strk20.json`,
`contracts/target/dev/`.

| Class                       | Declared class hash                                          |
|-----------------------------|--------------------------------------------------------------|
| CapabilityGatekeeper        | `0x62b8b737e10c4b06727e9ef672fc0163f8331388e812a249f28cc9edaa63efe` |
| CapabilityToken             | `0x408fa2fde6f253b3771c43181c8eb8c7f5f71a929c4bd74cb0b25852e5a17e7` |
| TreasurySpendAdapter        | `0x7617280a31c7ffbf16b5eb18e7f783d1953d295277b293eb816b304041a3da0` |

Reference deployed instances (proof the flow works, not Studio's mandate):

| Component           | Address                                                     |
|---------------------|-------------------------------------------------------------|
| CapabilityGatekeeper | `0x01126ea67555e0d82c51efe0352f9cf99aec81b7af40ff9c3dab4ccced5b8ff8` |
| TreasurySpendAdapter | `0x021a77531446c9a0e581e4199d9296d00fe45d279c631d0d0ab16cc66340afd7` |
| CapabilityToken      | `0x0567bbe5adafeb5920849c695f158bb3d287c702396fa1f87eb9e4978e39b11d` |
| STRK20 pool          | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

Verified transactions (evidence, not fixtures — must never appear as Studio
history):

- private-pass issuance: `0x26a63750cb24beb38cc4eb8a976d04458c9015331b63be89a71c309a2b8e589`
- holder exercise:     `0x7978bc0e9292a86c9e01411784dd6ec3db117e967a2ec08a2131844579d1386`

---

## 2. Existing SDK — inventory

Source: `packages/capability-sdk/src/index.mjs` (419 lines, no dependencies,
`"type": "module"`, `"name": "@blackbox/capability-sdk"`).
Tests: `tests/capability-sdk.test.mjs` (243 lines, `node --test`).
README: `packages/capability-sdk/README.md`.

### 2.1 Public exports (canonical, frozen, no signer)

| Export                                         | Purpose                                            |
|------------------------------------------------|----------------------------------------------------|
| `CAPABILITY_UNIT` (= `1n`)                     | Single-pass unit.                                  |
| `OPEN_AMOUNT` (= `"OPEN"`)                     | Marker for STRK20 open-note amount.                |
| `normalizeFelt(value, label)`                  | Validate + stringify felt252.                      |
| `validatePolicy(input)`                        | Normalize a public policy; reject zero/bad inputs. |
| `buildRegisterPolicyCall(input)`               | Encode `register_policy` calldata.                 |
| `buildPolicyStatusCall({ gatekeeper, capabilityToken, active })` | Encode `set_policy_active` calldata.   |
| `encodeGatekeeperCalldata({ ... })`            | Encode `privacy_invoke` calldata.                  |
| `buildCapabilityInvokePlan({ ... })`           | Low-level plan for advanced privacy clients.       |
| `buildWalletApiCapabilityActions({ ... })`     | STRK20 Wallet API action list (reusable + one-shot). |
| `buildWalletApiCapabilityDepositActions({ ... })` | STRK20 Wallet API action list for issuer deposit. |
| `buildTreasuryDeploymentPlan(input)`           | Frozen `UNSIGNED_PLAN` for the Treasury Mandate.   |
| `describeDisclosure({ reusable })`             | Hidden / public / warning disclosure copy.         |

### 2.2 Verified behaviour from the source

- `buildTreasuryDeploymentPlan` (a) rejects any input whose keys match
  `/private|secret|mnemonic|viewing|credential|signer/i` recursively
  (`rejectSecretFields`); (b) returns a frozen object with
  `status: "UNSIGNED_PLAN"`, `requiresOwnerApproval: true`, an ordered
  `declarations` array, a `deployments` array, a `setupCalls` array (with
  `signerRole`), `privacySteps` and `warnings`; (c) the deployments use
  `$gatekeeper` / `$treasuryAdapter` / `$capabilityToken` symbolic references
  that a deployer resolves after each step is confirmed; (d) it asserts
  `maxAmount > 0`, `expiresAt > 0`, `supply > 0`,
  `treasuryAllowance >= maxAmount`.
- `validatePolicy` enforces `expiresAt > 0`, non-zero addresses, and that
  `enforceFirstArgMax` and `reusable` are real booleans.
- `buildWalletApiCapabilityActions` produces (a) a `withdraw` of one unit to
  the Gatekeeper, (b) an optional `transfer` of `OPEN_AMOUNT` to the holder
  (reusable only), and (c) an `invoke` of the Gatekeeper with calldata
  containing a `returnNoteId` placeholder (`${openNoteIds[0]}` for reusable,
  `0x0` for one-shot). The wallet/relayer is responsible for substituting the
  real note id.
- `buildWalletApiCapabilityDepositActions` produces a single `deposit` action
  that converts an issuer's public ERC-20 balance into a private note.

### 2.3 What the SDK does **not** do

- No signing, no key handling, no relayer, no fee estimation, no
  class-hash computation, no `declare`/`deploy`/`execute` calls. All
  transaction submission is left to the caller (the existing `apps/web` page
  or, in Studio, an isolated Studio module).

---

## 3. Existing wallet flows — inventory

Source: `apps/web/src/wallet-operator.mjs`, `apps/web/src/issue.mjs`,
`apps/web/src/holder-app.mjs`, `apps/web/src/deploy.mjs`,
`apps/web/src/issue.html`, `apps/web/src/holder-app.html`.

### 3.1 Wallet discovery and feature gate

- `requirePrivacyWalletFeature(wallet)` (wallet-operator.mjs) checks
  `wallet.features["starknet:walletApi"].request` is a function. Without it
  the wallet cannot perform STRK20 invocations.
- `createStore({ eip1193Adapters: [] })` from
  `@starknet-io/get-starknet-discovery` is the canonical store; MetaMask is
  filtered out by name.
- `MAINNET_CHAIN_ID` is the string `"0x534e5f4d41494e"`.
- Wallet connection uses `WalletAccountV6.connect(provider, wallet)`.
- Network check: `walletV6.requestChainId(wallet)` → must equal
  `MAINNET_CHAIN_ID`.

### 3.2 Deployment (existing mainnet flow)

`apps/web/src/deploy.mjs` describes the full verified sequence. The exact
ordering is the source of truth that Studio must mirror:

1. Load `deployment/config.json` and six declaration artifacts
   (`.sierra.json` + `.casm.json` for each of `CapabilityGatekeeper`,
   `CapabilityToken`, `TreasurySpendAdapter`).
2. Compute each class hash from its sierra with
   `hash.computeContractClassHash(...)`.
3. For each missing class, call the raw
   `wallet_addDeclareTransaction` Wallet API request
   (`{ contract_class, compiled_class_hash }`). The wallet owns fee
   estimation, signing and broadcast. If the wallet reports
   `already declared`, treat the class as declared and continue.
4. Deploy `CapabilityGatekeeper` with constructor
   `[privacyPool]`.
5. Deploy `TreasurySpendAdapter` with constructor
   `[gatekeeper, treasury, asset, recipient]`.
6. Deploy `CapabilityToken` with constructor
   `[shortString.encodeShortString(capabilityName), shortString.encodeShortString(capabilitySymbol), issuer, privacyPool, gatekeeper]`.
7. Single multi-call `account.execute` that issues in order:
   - `gatekeeper.register_policy(token, adapter, getSelectorFromName("spend"), 0x1, maxAmount, expiresAt, 0x1)`.
   - `asset.approve(adapter, treasuryAllowance, 0x0)`.
   - `token.mint(issuer, supply, 0x0)`.
8. After every transaction, `provider.waitForTransaction(hash, { retries:
   120, retryInterval: 3000 })`; only an `isSuccess()` receipt counts as
   confirmed.
9. Progress is persisted under
   `localStorage["blackbox:mainnet-policy:deployment-progress:v1"]`. On
   reload, each step is detected from this object so the user can resume
   from any interrupted step.

Studio must reuse the same step order and the same per-step wallet
confirmations. A Studio user must never see a "Deploy" button that performs
all six steps in a single confirmation.

### 3.3 Issuance (existing mainnet flow)

`apps/web/src/issue.mjs` describes the issuer experience:

1. Read current pool fee with
   `provider.callContract({ contractAddress: POOL, entrypoint: "get_fee_amount", calldata: [] })`. The
   returned `BigInt` is the **allowance** the STRK20 pool will need — it is
   **not** paid at approval time.
2. Issuer's wallet submits a 2-call `execute`:
   - `token.approve(POOL, 0x1, 0x0)` — public approval for exactly one pass.
   - `strk.approve(POOL, fee, 0x0)` — pool-fee allowance.
3. Wait for the approval to confirm. Persist
   `approvalBlock = receipt.block_number`.
4. Wait until `currentBlock >= approvalBlock + 10` (STRK20 needs a small
   confirmation window to avoid using fresh public state inside a proof).
5. Submit a STRK20 action list to the wallet:
   `{ type: "deposit", token: TOKEN, amount: "0x1" }` and
   `{ type: "transfer", token: TOKEN, amount: "0x1", recipient }`.
   The wallet uses its native `strk20InvokeTransaction` route; the page does
   **not** build the proof.
6. Wait for receipt; only `isSuccess()` counts as delivered.
7. Persist `localStorage["blackbox:mainnet-policy:issue-one-pass:v1"]` for
   recovery.

Studio's issuance path must use the same fee-read → approve → wait →
STRK20-deposit order, with the same confirmation-window check. Studio must
**not** build a parallel proof path.

### 3.4 Holder exercise (existing mainnet flow)

`apps/web/src/holder-app.mjs` shows what a correct holder flow looks like:

1. Connect holder wallet; require Wallet API support.
2. Verify `chain === MAINNET_CHAIN_ID`.
3. Read the public policy via
   `gatekeeper.get_policy(TOKEN)` and inspect the trailing `uses` field —
   once `uses >= 1` the demo's "one-time" walkthrough is finished. Studio
   must not treat `uses >= 1` as "policy consumed" for a **reusable**
   policy; for reusable, the walkthrough terminates on a different signal
   (see §4).
4. Build the action list with `buildWalletApiCapabilityActions` from the
   SDK, passing `holderAddress` (required for reusable), `targetCalldata:
   [PAYMENT]`, and the policy object assembled from public chain state.
5. Submit via `holderAccount.strk20InvokeTransaction(actions)`. Wait for
   receipt.
6. Persist the payment transaction hash under
   `localStorage["blackbox:holder:payment:v1"]`; on reload, resume the
   confirmation state instead of triggering a second confirmation.

### 3.5 Lessons preserved from the existing flows

- A returned transaction hash is **submitted, not successful**. Always
  `waitForTransaction` and check `receipt.isSuccess()`.
- The wallet-native `strk20InvokeTransaction` route is the verified path.
  Ready's ordinary `invoke` route dropped the SNIP-36 proof in earlier
  testing.
- The pool fee is read at runtime; never hard-code it.
- Pool-fee allowance, capability-token allowance, and treasury allowance
  are three separate concepts and three separate transactions.
- Wallet rejection, partial completion, and page reload must leave the
  user in a recoverable state. The localStorage progress keys above are
  the existing pattern; Studio will adopt the same shape with Studio-only
  key names.

---

## 4. Field-to-enforcement map

This is the contract that Studio's wizard must satisfy. Every Studio field
maps to a real constraint enforced by the contracts above or to a real
artifact the contracts depend on.

| Studio wizard field                       | Source of truth                                            | Enforced where |
|-------------------------------------------|------------------------------------------------------------|----------------|
| Treasury wallet address                   | `TreasurySpendAdapter.constructor.treasury`                | Adapter storage, immutable |
| Payment asset address                     | `TreasurySpendAdapter.constructor.token`                   | Adapter storage, immutable |
| Approved recipient address                | `TreasurySpendAdapter.constructor.recipient`               | Adapter storage, immutable; also re-checked inside `spend` |
| Maximum amount per payment (u128)         | `Gatekeeper.register_policy.max_first_arg` + `enforce_first_arg_max: true` | Gatekeeper storage + `privacy_invoke` |
| Total approved budget (treasury allowance, u128) | `ERC20(asset).approve(adapter, treasuryAllowance)` + `buildTreasuryDeploymentPlan` invariant `treasuryAllowance >= maxAmount` | Onchain allowance; the contract does **not** track "remaining budget" — that is derived offchain as `allowance - sum(spent)` |
| Pass supply (u128)                        | `CapabilityToken.mint(issuer, supply)`                     | Token storage (`total_supply`) |
| Behaviour: reusable / one-shot            | `Gatekeeper.register_policy.reusable`                      | Gatekeeper storage + branching in `privacy_invoke` |
| Expiry (unix seconds)                     | `Gatekeeper.register_policy.expires_at` (`> now`)          | Gatekeeper storage + `privacy_invoke` (`expires_at < now → POLICY_EXPIRED`) |
| Operator receiving wallet                 | Out-of-band recipient of the private-pass note; **not** an onchain configuration of the Gatekeeper | Wallet/relayer only — the onchain adapter's `recipient` is the **payee**, not the pass recipient |
| Privacy pool address                      | `Gatekeeper.constructor.privacy_pool`; also `CapabilityToken.constructor.privacy_pool` | Both contracts; must match each other (enforced at `register_policy`) |
| Issuer address                            | `CapabilityToken.constructor.issuer`                       | Token storage; `register_policy` requires `caller == token.get_issuer()` |
| Capability name (felt252)                 | `CapabilityToken.constructor.name`                         | Token storage |
| Capability symbol (felt252)               | `CapabilityToken.constructor.symbol`                       | Token storage |
| Wallet API support                        | `requirePrivacyWalletFeature`                              | Offchain gate only; the contract is unaware |

Field constraints Studio will apply **before** producing a deployment plan
(mirrors `PRODUCT_REQUIREMENTS.md`):

- All addresses must be a valid non-zero `0x`-prefixed felt252.
- `maxAmount > 0`.
- `treasuryAllowance >= maxAmount` (single payout must always be
  fundable; SDK's `buildTreasuryDeploymentPlan` enforces this).
- `expiresAt > now` and `expiresAt < 2^64`.
- `supply > 0`.
- `maxAmount <= 2^128 - 1` and `treasuryAllowance <= 2^128 - 1`.
- `reusable` and `enforceFirstArgMax` are real booleans.
- No field name may match the secret-rejecting regex
  `/private|secret|mnemonic|viewing|credential|signer/i` — the existing
  SDK already enforces this, and Studio re-uses the SDK so the check
  travels with it.
- `recipient` and `treasury` must be different addresses (treasury
  funding its own adapter would be meaningless and would fail the
  `recipient != 0` and `treasury != 0` checks only — Studio adds a UX
  guard on top).

What the contracts do **not** enforce and Studio must not silently
infer:

- The "remaining budget" (the difference between `treasuryAllowance`
  and `adapter.total_spent`) is **not** a contract field. Studio must
  compute it client-side from `asset.allowance(treasury, adapter)` and
  `adapter.total_spent()`, and label it as "remaining public
  allowance" — not as a private balance.
- The "pass supply remaining" is `token.balanceOf(gatekeeper) +
  sum(STRK20 open-note balances)` — but the second term is **not**
  publicly readable. Studio can only display the onchain
  `token.balanceOf(gatekeeper)` and **must not** pretend to know how
  many private notes are outstanding.

---

## 5. Deployment / setup transaction sequence

This is the exact sequence Studio's deployment planner will produce. Each
step is one wallet confirmation unless explicitly noted.

| # | Step | Caller (signerRole) | Target | Calldata shape (high level) | Address prediction |
|---|------|---------------------|--------|------------------------------|--------------------|
| 1 | Declare `CapabilityGatekeeper` (skip if already declared) | issuer | `wallet_addDeclareTransaction` (Wallet API) | `{ contract_class, compiled_class_hash }` | n/a (class hash known) |
| 2 | Declare `CapabilityToken` (skip if already declared) | issuer | `wallet_addDeclareTransaction` | same | n/a |
| 3 | Declare `TreasurySpendAdapter` (skip if already declared) | issuer | `wallet_addDeclareTransaction` | same | n/a |
| 4 | Deploy `CapabilityGatekeeper` | issuer | `account.deploy` | constructor `[privacyPool]` | Contract address returned in `contract_address[0]` |
| 5 | Deploy `TreasurySpendAdapter` | issuer | `account.deploy` | constructor `[gatekeeper, treasury, asset, recipient]` | Contract address returned |
| 6 | Deploy `CapabilityToken` | issuer | `account.deploy` | constructor `[name, symbol, issuer, privacyPool, gatekeeper]` (name/symbol via `shortString.encodeShortString`) | Contract address returned |
| 7 | Setup multi-call (one wallet confirmation) | issuer | `account.execute` | three calls in order: `gatekeeper.register_policy(token, adapter, getSelectorFromName("spend"), 0x1, maxAmount, expiresAt, reusable)`, `asset.approve(adapter, treasuryAllowance, 0x0)`, `token.mint(issuer, supply, 0x0)` | n/a (state changes only) |

`buildTreasuryDeploymentPlan` already returns steps 4, 5, 6 as the
`deployments` array and the three setup calls as `setupCalls`. Studio
will wrap that output, add the declaration checks (1–3), and execute
each step through the connected wallet.

Address prediction: Starknet does not expose CREATE2-style pre-image
address computation through a public RPC at the time of writing, so
Studio will not attempt to pre-compute the Gatekeeper / Adapter / Token
addresses. Instead, after step 4 (Gatekeeper deploy) confirms, Studio
captures the returned `contract_address` and uses it as the constructor
argument of step 5, and so on. The deployment review screen will
display addresses only after each step is verified, never as a
prediction.

What is predictable **without** a signature:

- The class hash of each of the three contracts (from the committed
  `contracts/target/dev/*.contract_class.json` artifacts and the
  existing mainnet declaration evidence).
- The selector of the target entrypoint: `hash.getSelectorFromName("spend")`.
- Whether a class is already declared on the chosen network, by calling
  `provider.getClassByHash(classHash)` (the existing `deploy.mjs` does
  this).

What requires a wallet signature and is therefore shown as a
"requires wallet" step, not a prediction:

- Every declaration.
- Every deploy.
- The final setup `execute` multi-call.
- Every `approve` and `mint` (covered by setup).
- The issuance flow's approvals and STRK20 deposit.
- The holder's `strk20InvokeTransaction`.

---

## 6. SDK dependency strategy

Two options are available. **Selected: option B (copy with provenance).**

### Option A — consume the existing package through the workspace

The repository already declares `@blackbox/capability-sdk` at
`packages/capability-sdk/` and the existing apps import it by relative
path (e.g. `apps/web/src/holder-app.mjs` imports
`"../../../packages/capability-sdk/src/index.mjs"`). Studio could do the
same.

Pros: zero duplication, automatic alignment with SDK fixes.
Cons: ties Studio's build to a path outside `apps/studio/`. Per
`AGENTS.md` ("Studio must not import source files by relative paths
that make it depend on uncommitted edits to the existing application")
this is exactly the dependency shape Studio must avoid. Any
uncommitted edit to `packages/capability-sdk/` would silently change
Studio's behaviour.

### Option B — copy a minimal browser adapter into Studio

Studio copies a frozen snapshot of the SDK's public exports into
`apps/studio/src/sdk/blackbox-capability-sdk.mjs` and imports from that
local path. The snapshot is committed inside `apps/studio/`, so Studio
cannot accidentally depend on a future SDK change.

Pros: matches the `AGENTS.md` isolation rule exactly; Studio is
shippable independently; easy to add a regression test that re-evaluates
the upstream SDK against the Studio copy.
Cons: requires a one-time copy plus a parity test (see §8).

### Provenance of the copy

- Source file: `packages/capability-sdk/src/index.mjs` (419 lines,
  fetched 2026-08-28).
- SHA-256: will be recorded in `STATUS.md` once the file is copied.
- Pinned exports used by Studio: `validatePolicy`,
  `buildTreasuryDeploymentPlan`, `buildRegisterPolicyCall`,
  `buildPolicyStatusCall`, `encodeGatekeeperCalldata`,
  `buildCapabilityInvokePlan`, `buildWalletApiCapabilityActions`,
  `buildWalletApiCapabilityDepositActions`, `describeDisclosure`,
  `normalizeFelt`, `CAPABILITY_UNIT`, `OPEN_AMOUNT`. Excluded from the
  copy: none (the file has no signer-aware exports).
- The copy keeps the file's preamble comment intact and prepends a
  Studio-specific provenance banner including upstream path, commit,
  and the public Mainnet class hashes that the SDK targets.

### Module-level copy of proven wallet code

`apps/web/src/wallet-operator.mjs` is the source of truth for
`MAINNET_CHAIN_ID`, `requirePrivacyWalletFeature`, `shortHex`,
`walletErrorMessage`, and `parseTargetCalldata`. Studio will copy
those helpers verbatim into
`apps/studio/src/wallet/wallet-utils.mjs` and add a banner citing
`apps/web/src/wallet-operator.mjs` and the file's last-modified date.

---

## 7. Class-hash verification method

The class hash is the onchain identity of a contract class. Studio
must never trust a class hash that is not derived from the same
sources the existing app trusts. The verification method, in order of
preference:

1. **Read from the existing reference deployment.** The class hashes
   in `REUSE_MAP.md` and `strk20.json` are committed and were the
   source for the already-deployed reference instances. If the
   declared class hash from step 3 matches one of these, treat it as
   verified. (Source files:
   `apps/studio/docs/REUSE_MAP.md`,
   `BlackBox Arena/strk20.json`.)
2. **Compute from the committed Sierra artifact.**
   `contracts/target/dev/blackbox_arena_contracts_CapabilityGatekeeper.contract_class.json`
   is the canonical Sierra for the class. Studio will load it
   (bundled with the Studio build, **not** fetched at runtime) and
   call the same hashing routine as
   `apps/web/src/deploy.mjs`:
   `hash.computeContractClassHash(payload.contract)`. The result must
   equal the value in step 1.
3. **Confirm declaration onchain.** Before deploying an instance, call
   `provider.getClassByHash(classHash)`. A successful response
   confirms the class is live on the chosen network. The same call is
   used to skip the declaration step if the class is already
   declared.
4. **For freshness, never compile a new Sierra at Studio build time.**
   Studio bundles the existing artifacts and a frozen copy of the
   hashing function. If a future build is needed, the Studio commit
   must bump the bundled artifact and re-record the hash in
   `STATUS.md`. New Cairo compilation is a change to the protocol and
   is out of scope for Studio.

---

## 8. Recovery model

Studio must never trap the user in an unrecoverable state. The
recovery model has three pieces.

### 8.1 Browser-local draft

Studio persists a draft configuration under
`localStorage["blackbox:studio:draft:v1"]`. The draft contains only
**public** data: addresses, amounts, expiry, behaviour flag, names.
The Studio SDK copy's `rejectSecretFields` will reject any future
attempt to add a field whose name matches the secret regex; the
browser-local draft is the second line of defence. Drafts are
labelled "draft" in every list and never appear under a connected
wallet.

### 8.2 Deployment progress

Studio mirrors the existing `deploy.mjs` progress key shape:

- `classes.CapabilityGatekeeper`, `classes.CapabilityToken`,
  `classes.TreasurySpendAdapter` — declared class hashes.
- `gatekeeper`, `adapter`, `token` — deployed addresses.
- `setupTransaction` — the `execute` transaction hash.
- `deployment` — the same config object fed to
  `buildTreasuryDeploymentPlan`.

After every successful confirmation, Studio persists the new field
**and** verifies it onchain (`provider.getClassByHash`, then
`get_policy(token)` reads back the onchain state). If the onchain
state already shows the step as complete, Studio marks it complete
even if the local state was lost (refresh / device change). The
deployment review screen always reads the **onchain** state, never
the local state, to decide which step is "next".

### 8.3 Cancellation and partial completion

The existing `walletErrorMessage` already maps the most common wallet
failure modes. Studio will reuse it. The UI rule: a step is "Not
started" / "Awaiting wallet" / "Submitted" / "Confirming" /
"Verified" / "Failed" — see `UI_DIRECTION.md` for the chip language.
A failed step offers `Retry` (re-submit the same call), `Review
error` (open the wallet's error text), and `Exit safely` (return to
the dashboard; the local draft is preserved). A "Verified" step is
never re-sent, even on retry, because Studio re-derives the
"Verified" state from the onchain read.

### 8.4 Refresh and device change

If the user refreshes the page mid-deployment, Studio re-derives the
progress from the local key first, then verifies against onchain
state. If the local key is empty but the onchain state already shows
the step complete, Studio accepts that and continues from the next
step. If the user switches devices entirely, the deployment cannot
be resumed because the issuer wallet would have to be re-connected
and the declarations are public anyway — Studio offers a "Start new
mandate" path that asks the user to re-confirm the configuration.

---

## 9. Privacy boundary (Studio's view)

The privacy boundary is the same boundary the existing product
enforces. Studio's job is to **not weaken it**.

### 9.1 Public (visible onchain and in Studio UI)

- The connected organization wallet (the issuer).
- The policy and contract addresses (Gatekeeper, Treasury Adapter,
  CapabilityToken).
- The treasury, asset, recipient, per-use cap, total allowance,
  expiry, and reusable flag (all `register_policy` arguments +
  `TreasurySpendAdapter.get_config()`).
- The pool fee allowance, capability-token allowance, and treasury
  allowance transactions.
- The final `TreasurySpent` event (treasury, token, recipient,
  amount, total_spent).
- The initial shield deposit address, token, and amount (these are
  public onchain; calling them "private" is forbidden by
  `AGENTS.md` and `PRODUCT_REQUIREMENTS.md`).

### 9.2 Private (wallet-owned, never persisted by Studio)

- Capability note ownership and the private pass balance.
- Note plaintext, viewing key, proof material, seed phrase, signer
  credentials.
- The wallet's internal note discovery / relayer state.
- Holder-to-use link, subject to the wallet's relay and metadata
  assumptions.

### 9.3 Studio's operational rules

- Studio never calls `getClassByHash` or `get_policy` for a wallet
  that did not connect. The dashboard reads only the policies
  controlled by the **connected** organization wallet.
- Studio never stores or logs the strings "viewing key", "mnemonic",
  "private key", "seed phrase", "credential", or "signer" anywhere
  in `apps/studio/`. The SDK's `rejectSecretFields` is the
  structural guard; Studio also adds a static secret scan in its
  build step (see §11).
- The holder link `/studio/use?policy=<public-policy-id>` identifies
  the **public policy** only. The link is not a capability. The
  holder must connect the wallet that received the pass.

---

## 10. Wallet API surface Studio will use

| API | Source | Where Studio will use it |
|-----|--------|---------------------------|
| `WalletAccountV6.connect(provider, wallet)` | existing `apps/web/src/*.mjs` | wallet connect |
| `walletV6.requestChainId(wallet)` | existing | network check |
| `account.execute(calls)` | existing `deploy.mjs`, `issue.mjs` | setup multi-call, public approvals |
| `account.deploy({ classHash, constructorCalldata })` | existing `deploy.mjs` | per-contract instance deploy |
| `account.estimateDeclareFee(payload)` | existing `deploy.mjs` | optional fee preview |
| `wallet.features["starknet:walletApi"].request(...)` for `wallet_addDeclareTransaction` | existing `deploy.mjs` | class declaration |
| `account.strk20InvokeTransaction(actions)` | existing `issue.mjs`, `holder-app.mjs` | private issuance + holder exercise |
| `account.strk20PrepareInvoke(actions, true)` (optional) | SDK README | simulate + prove (optional, never the sole path) |
| `provider.callContract(...)` | existing | read-only views (policy, fee, balance, total_spent) |
| `provider.waitForTransaction(hash, { retries, retryInterval })` | existing | receipt verification |
| `provider.getClassByHash(classHash)` | existing `deploy.mjs` | declaration check |
| `hash.computeContractClassHash(contract)` | existing `deploy.mjs` | local class-hash verification |

Every one of these is a method the existing app already uses. Studio
is not introducing a new wallet surface.

---

## 11. Phase 0 gate and required output for Phase 1

The Phase 0 gate is satisfied when **all** of the following are true:

1. This document exists at
   `apps/studio/docs/PHASE0_ARCHITECTURE.md` and is referenced from
   `STATUS.md`.
2. The Studio SDK copy exists at
   `apps/studio/src/sdk/blackbox-capability-sdk.mjs` and its
   provenance banner cites `packages/capability-sdk/src/index.mjs`.
3. A parity test exists at
   `apps/studio/test/sdk-parity.test.mjs` that imports **both** the
   Studio copy and the upstream SDK and asserts that
   `buildTreasuryDeploymentPlan` and `validatePolicy` return identical
   results for a fixed fixture.
4. The Studio copy of wallet utilities exists at
   `apps/studio/src/wallet/wallet-utils.mjs` and its banner cites
   `apps/web/src/wallet-operator.mjs`.
5. A secret-scan test exists at
   `apps/studio/test/secret-scan.test.mjs` that asserts no
   `apps/studio/` file contains a string matching the secret
   pattern.
6. `STATUS.md` records (a) the file paths created, (b) the upstream
   commit referenced, (c) the explicit statement "no file outside
   `apps/studio/` was modified", (d) any gap that needs owner
   approval.

The Phase 0 gate does **not** include:

- Any UI code under `apps/studio/src/ui/`.
- Any web framework choice (React, Vite, Svelte, plain HTML, …).
- Any build script beyond the parity / secret-scan tests above.
- Any Vercel or production-route configuration.
- Any wallet-flow code that has not been copied from the existing app
  with provenance.

UI implementation is a Phase 1 decision. Phase 0 ends with the
documentary evidence above and a yes/no answer to: "is the Studio
team ready to wrap, not rebuild, the existing BlackBox Protocol?".

---

## 12. Open questions and gaps

These are real gaps between what the existing protocol can do and what
Studio's docs promise. They must be resolved before the corresponding
phase, with explicit owner approval for any change.

- **Discovered-classes for new mandates.** The declared class hashes
  in §1.5 are the classes used by the reference deployment. The
  existing mainnet flow re-declares these classes once at
  App-Deploy time, then deploys fresh instances for every mandate.
  Studio's question: do we (a) verify the classes are still declared
  on Mainnet, declare them again if not, then deploy instances, or
  (b) require the user to supply the class hashes from a trusted
  source? Default plan: (a), mirroring `deploy.mjs`. **Owner
  approval required if the answer changes.**
- **STRK20 pool address.** Studio needs a single STRK20 pool address
  per network. The reference config in `configs/mainnet-demo.json`
  hard-codes one. Studio will default to the same value with a
  visible "Pool address from existing BlackBox reference" label and
  a clear "coming soon" if the user is on a different network.
  Multi-pool support is out of scope.
- **STRK as the only asset.** The reference deployment uses STRK.
  Studio's wizard will allow any ERC-20 address but will not
  validate that the chosen asset is compatible with the configured
  pool. This is a known limitation; the wizard shows a warning when
  the asset is not the pool's STRK.
- **Issuer = treasury.** The reference config uses the same address
  for `issuer` and `treasury`. Studio will allow them to differ, but
  will warn when they do because the issuer wallet must hold
  `supply` passes and the treasury must hold the asset allowance.
- **No arbitrary calls.** The user flow already says "Cannot do:
  change recipient, asset, or arbitrary calldata." Studio's planner
  must hard-code the target selector to `spend` and the target
  address to the freshly deployed `TreasurySpendAdapter`. There is no
  "advanced" override in Studio. This is a deliberate product
  constraint, not a missing feature.

---

## 13. Index of files referenced

Inside `apps/studio/`:
- `AGENTS.md`, `README.md`
- `docs/GOAL.md`, `docs/USER_FLOW.md`, `docs/UI_DIRECTION.md`,
  `docs/REUSE_MAP.md`, `docs/PRODUCT_REQUIREMENTS.md`,
  `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`,
  `docs/STATUS.md`, `docs/HANDOFF.md`, `docs/PHASE0_ARCHITECTURE.md`
  (this file)

Outside `apps/studio/` (read-only):
- `contracts/src/lib.cairo`
- `contracts/src/capability_gatekeeper.cairo`
- `contracts/src/capability_token.cairo`
- `contracts/src/treasury_spend_adapter.cairo`
- `contracts/Scarb.toml`
- `contracts/target/dev/blackbox_arena_contracts_CapabilityGatekeeper.contract_class.json`
  (and the other five class JSON files for Token and Adapter)
- `packages/capability-sdk/src/index.mjs`
- `packages/capability-sdk/README.md`
- `packages/capability-sdk/package.json`
- `tests/capability-sdk.test.mjs`
- `apps/web/src/wallet-operator.mjs`
- `apps/web/src/issue.mjs`
- `apps/web/src/holder-app.mjs`
- `apps/web/src/deploy.mjs`
- `apps/web/src/issue.html`
- `apps/web/src/holder-app.html`
- `configs/mainnet-demo.json`
- `strk20.json`
- `BlackBox Arena/AGENTS.md`

No file outside `apps/studio/` was modified during Phase 0.
