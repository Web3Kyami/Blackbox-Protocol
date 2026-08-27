# `@blackbox/capability-sdk`

Pure, wallet-neutral helpers for BlackBox capability policies, STRK20 Wallet
API actions, low-level Privacy SDK plans, disclosures, and unsigned deployment
planning. The package has no dependencies and never accepts viewing keys,
private keys, mnemonics, signers, or credentials.

## STRK20 Wallet API

The Wallet API is the preferred dapp route. A compatible wallet manages private
notes, proving, and rotating-relayer submission:

```js
import { buildWalletApiCapabilityActions } from "@blackbox/capability-sdk";

const actions = buildWalletApiCapabilityActions({
  policy,
  holderAddress: wallet.address, // required only for reusable passes
  targetCalldata: [75n],
});

await wallet.strk20PrepareInvoke(actions, true); // prove + simulate first
const { transaction_hash } = await wallet.strk20InvokeTransaction(actions);
```

A reusable plan produces three actions: withdraw one pass to the Gatekeeper,
open a replacement one-unit pass note, and invoke the Gatekeeper with the
wallet-resolved `${openNoteIds[0]}` placeholder. A one-shot plan omits the open
note and passes zero as its return-note id.

For issuance, mint passes to the issuer first, make the issuer's ordinary
public ERC-20 approval for the pool, then submit the wallet-owned deposit:

```js
import { buildWalletApiCapabilityDepositActions } from "@blackbox/capability-sdk";

await issuerWallet.strk20InvokeTransaction(
  buildWalletApiCapabilityDepositActions({ capabilityToken, amount: 10n }),
);
```

Minting an ERC-20 directly to the pool does not create a private note.

## Low-level Privacy SDK

Advanced clients can use `buildCapabilityInvokePlan`. It returns withdrawals,
open-note requirements, and a `resolveInvoke(openNoteIds)` callback. The caller
still owns discovery, note selection, proving, and outside execution.

## Public administration

- `validatePolicy` normalizes the public policy.
- `buildRegisterPolicyCall` encodes `register_policy`.
- `buildPolicyStatusCall` encodes class-wide pause/reactivation.
- `buildTreasuryDeploymentPlan` creates a dependency-ordered unsigned plan and
  rejects secret-bearing configuration.
- `describeDisclosure` returns the product's hidden/public/warning copy.

Client-side validation is an early error message, not authorization. The Cairo
Gatekeeper remains the authority for target, selector, amount, expiry, mode,
delivery freshness, replay protection, and revocation.

## Privacy boundary

The deposit address, token, and amount are public. The target, calldata, timing,
and state change are public. Holder transaction-sender privacy requires the
Wallet API's relayer or another tested outside-execution path. Network, RPC,
wallet, and browser metadata are outside the contract guarantee.
