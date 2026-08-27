# BlackBox Protocol vNext

**Status:** contract enforcement, the full local STRK20 pool flow, and browser
Wallet API wiring are verified locally. A real extension-wallet run,
public-network deployment, and mainnet behavior remain `UNVERIFIED`.

## Product

> **Public rules. Private operators.**

BlackBox lets a Starknet protocol delegate bounded onchain authority without
publishing the wallet that receives or exercises it. A protocol publishes a
capability policy, deposits bearer passes through STRK20, privately transfers
them, and trusts a
Gatekeeper contract—not an offchain dashboard—to enforce every use.

The first buyer is a protocol, DAO, or treasury that needs private operators,
keepers, guardians, or one-shot execution mandates. Anonymous community
signalling (BlackBox Voice) is a reference module, not the primary product.

BlackBox is not an agent leaderboard, generic form builder, private wallet, or
universal controller for a user's STRK20 balance.

## One-sentence interface

> Create a public policy, send its permission privately, and let the holder act
> without exposing their wallet.

## Protocol objects

### Capability policy

One capability-token contract identifies one policy class. The Gatekeeper stores:

- issuer/admin;
- exact target contract and entrypoint selector;
- optional maximum for the first calldata argument;
- expiration timestamp;
- one-shot or reusable mode;
- active/revoked status and successful-use count.

The policy is public. v1 deliberately avoids pretending arbitrary calldata can
be understood generically: the first-argument limit is safe only for target
entrypoints whose first argument has the documented numeric meaning. More
complex policies require audited target-specific adapters. The included
`TreasurySpendAdapter` demonstrates that pattern by permanently binding the
treasury, ERC-20 asset, and recipient, leaving only its first `amount` argument
under holder control.

### BlackBox Pass

`CapabilityToken` is an issuer-minted ERC-20 with zero decimals. One base unit
is one bearer capability. The issuer deposits passes into STRK20 and sends
one-unit private notes to operators.

The pass is transferable. Whoever possesses its note can exercise it. This is
private delegation, not proof of human identity. v1 supports class-wide pause
or revocation; private individual revocation needs a different credential/proof
design and is not claimed.

### Gatekeeper

`CapabilityGatekeeper.privacy_invoke` is callable only by its configured privacy
pool. It verifies the policy, consumes a transaction-bound delivery marker from
the capability token, calls the exact target/selector, and then:

- burns a one-shot pass; or
- approves one reusable pass back to the pool and returns an
  `OpenNoteDeposit` for the caller's new open note.

The target contract sees the Gatekeeper as caller. A protected protocol must
grant authority to the Gatekeeper and leave no unguarded bypass for the same
operation.

## Current-transaction binding

A persistent helper balance is not proof that a pass arrived in the current
privacy callback. A pass can be unshielded to the helper in an earlier
transaction and otherwise authorize an unrelated pool user.

BlackBox prevents that preload attack in the capability token itself:

1. The configured STRK20 pool transfers one pass to the configured Gatekeeper.
2. `CapabilityToken` records the current Starknet transaction hash and amount
   only for that exact pool-to-Gatekeeper transfer.
3. During the callback, the Gatekeeper asks the token to consume a one-unit
   delivery marker.
4. The token requires the recorded transaction hash to equal the callback's
   current transaction hash and rejects reuse.

An earlier transfer, direct user transfer, wrong amount, or second use cannot
authorize an action. Cairo tests prove these contract invariants, and the real
local STRK20 pool E2E verifies transfer-then-invoke ordering for both reusable
and one-shot passes. Public-network and mainnet ordering remain `UNVERIFIED`.

## User flow

### Protocol administrator

1. Create a Gatekeeper-backed capability policy from a template.
2. Review the exact public target, selector, limit, expiry, and reuse mode.
3. Deploy a `CapabilityToken` bound to the issuer, pool, and Gatekeeper.
4. Register the policy, mint the desired supply to the issuer, then publicly
   approve and deposit the passes into STRK20. A direct token mint to the pool
   does not create a private note.
5. Privately transfer one-unit pass notes to operators.
6. Monitor public policy use counts and pause the class when needed.

### Capability holder

1. Discover the private pass in a compatible STRK20 wallet/client.
2. Review permitted and forbidden actions plus the hidden/public disclosure.
3. Connect a compatible Wallet API wallet, compose the permitted public action,
   and inspect the exact action array before preparation.
4. Spend one capability note to the Gatekeeper in the same transaction as the
   pool invocation. Preparation is wallet-owned and does not expose note
   plaintext or proof output to BlackBox.
5. Confirm submission through the Wallet API's rotating relayer. A low-level
   SDK integration must supply an equivalent outside-execution path; direct
   account submission reveals the holder in Starknet transaction metadata.
6. Verify the receipt and compare its public sender with the holder. BlackBox
   reports relay separation only when they differ. For reusable policies, receive a refreshed private
   one-unit pass note.

### Integrating protocol

1. Put the sensitive operation behind a Gatekeeper-only entrypoint or adapter.
2. Register a narrowly bounded policy for that target and selector.
3. Use the SDK to encode the pool invoke and show honest disclosures.
4. Test allowed, over-limit, wrong-target, expired, revoked, replay, and preload
   paths before assigning real authority.

## Reference cases

### Flagship: private treasury operator

A DAO approves the included `TreasurySpendAdapter` to pull one ERC-20 from its
treasury to one constructor-bound recipient. A pass holder chooses only the
payout amount, while the Gatekeeper enforces the public maximum and expiry. The
treasury, token, recipient, amount, and outcome remain public; relayed execution
keeps the operator wallet out of the action and transaction sender fields.

### Protocol keeper

A protocol privately issues passes that permit only maintenance selectors such
as settlement or position updates. Keeper actions stay auditable without
publishing the keeper wallet list.

### Emergency guardian

A short-lived pass permits only a named pause function. It must never include an
arbitrary call or withdrawal surface. The class is rotated after use.

### One-shot execution mandate

A pass authorizes one exact or tightly adapted contract action, then burns. It
does not grant general access to the holder's shielded account.

### BlackBox Voice

A DAO privately distributes one-shot participation passes. Members submit one
verified anonymous signal without turning BlackBox into a general Web2 forms
product.

## Privacy boundary

| Property | Status |
|---|---|
| Capability deposit address, token, total amount | Public |
| Private note recipient | Hidden by STRK20's note design; local discovery flow verified, anonymity claim depends on STRK20 |
| Issuance-to-use link | Intended hidden property; depends on STRK20 plus timing/metadata hygiene |
| Holder wallet in Gatekeeper calldata/caller | Absent; local E2E verifies pool is caller |
| Starknet transaction sender | Local E2E verifies a distinct outside-execution account; direct holder submission leaks identity |
| Capability token/class used | Public when withdrawn to Gatekeeper |
| Target, selector, calldata, timing | Public |
| Target contract state change | Public |
| Reusable open-note owner | Hidden by STRK20; token and filled amount public |
| Capability transferability | Possible by design |
| Network/RPC/browser metadata | Outside contract guarantee |

BlackBox hides who exercises authority. It does not hide what a public contract
ultimately does. That claim requires relayed submission: without a relay, the
holder is visible as transaction sender. Never call shielding itself private:
the deposit edge is public.

## Interfaces

The authoritative Cairo interfaces live in:

- `contracts/src/capability_token.cairo`
- `contracts/src/capability_gatekeeper.cairo`
- `contracts/src/treasury_spend_adapter.cairo`

The SDK exposes policy validation, Gatekeeper calldata encoding, exact STRK20
Wallet API action arrays, low-level one-shot and reusable invoke plans, unsigned
deployment planning, and the disclosure model. It does not handle viewing keys
or persist secrets.

The static web app implements the holder-side Wallet API path with
`WalletAccountV6`: wallet-standard feature detection, Mainnet gating, exact
action preview, preparation/simulation, separate execution confirmation, and
receipt-level sender comparison. It blocks example addresses and cannot deploy
contracts. A real extension wallet and deployed policy are required before this
surface is considered live.

## Security invariants

- Only the configured privacy pool can invoke the Gatekeeper.
- Only the capability issuer can register, pause, or reactivate its policy.
- A capability delivery is valid only in the transaction that delivered it.
- Exactly one capability unit is required per use.
- A delivery marker cannot be consumed twice.
- Target and selector must exactly match public policy.
- Enabled constraints must be checked before the target call.
- One-shot passes are burned after success.
- Reusable passes return only to an open note supplied in the same pool action.
- Any target failure reverts the entire capability use.
- Protected target functions must not expose an unguarded alternative caller.

## Delivery gates

1. **Local contract gate:** compile and adversarial Cairo tests.
2. **Pool E2E gate — VERIFIED locally:** real local STRK20 note issue → delivery
   → invoke → target action → reusable open-note rediscovery or one-shot burn,
   with a relay account distinct from the holder.
3. **Application gate:** administrator, holder, disclosure, and developer flows
   use real contract state with no fabricated fallback.
4. **Public-network rehearsal:** test network where supported; every unsupported
   privacy claim remains `UNVERIFIED`.
5. **Mainnet gate:** owner explicitly approves signing/deployment, at least three
   successful pool-touching transactions are recorded, and the exact deployed
   classes pass the full verification suite.

The hackathon is a product milestone, not an artificial cutoff for mainnet or
the end of the protocol. Mainnet work happens only after its safety and
integration gates pass and the owner explicitly approves signing.
