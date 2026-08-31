# User flow

User flow is the primary design constraint. Developer information belongs in a
secondary documentation area and must not dominate the product experience.

## Global navigation

- Studio home
- Create mandate
- Dashboard
- Help
- Wallet connection

Developer documentation may appear under Help or in the footer.

## 1. Studio home

The visitor should understand the product within ten seconds.

Primary message:

> Give an operator a private treasury permission while keeping control of your
> treasury key.

Primary action: **Create a mandate**

Secondary action: **View how it works**

The page explains:

- who uses Studio;
- what a Treasury Mandate controls;
- what remains public;
- what the operator receives;
- that the action is enforced by contracts.

It must not begin with SDK installation or deployment terminology.

## 2. Connect organization wallet

The protocol team connects a compatible Starknet wallet.

Show:

- connected address;
- network;
- whether the wallet supports required actions;
- a clear switch-wallet action;
- no invented organization profile.

The wallet address is the organization identity for the first release.

## 3. Choose mandate type

Searchable selector:

- Private Treasury Mandate — available.
- Keeper Permission — coming next.
- Emergency Guardian — coming next.
- One-shot Migration — coming next.

Only Treasury Mandate is selectable. Disabled options explain their intended
purpose without pretending they work.

## 4. Configure Treasury Mandate

Guided steps:

### Treasury

- treasury wallet;
- payment asset;
- approved recipient.

### Limits

- maximum per payment;
- total approved budget;
- pass supply.

### Capability behavior

- reusable or one-shot;
- expiry.

Role explanations appear beside the relevant decision instead of occupying a
separate wizard stop:

- the connected treasury wallet is the issuer;
- the payment recipient is required before deployment because the contract
  locks who receives the asset;
- the private-pass operator wallet is not collected during mandate creation;
  the issuer selects it later in Issue Pass.

Every input has a plain-language explanation and validation. Advanced contract
details are collapsed by default.

## 5. Privacy review

Before deployment, show two explicit columns.

Public:

- organization wallet;
- policy and contract addresses;
- treasury, asset, recipient, cap, budget, expiry, and mode;
- shielding/deposit address, token, and amount;
- final action and state change.

Private boundary:

- capability note ownership;
- note plaintext and proof material inside the wallet;
- holder-to-use relationship subject to wallet relay and metadata assumptions.

The user must acknowledge this boundary before continuing.

## 6. Deployment review

Show a human-readable plan before wallet prompts:

- which contracts will be deployed;
- which existing class hashes are reused;
- constructor meaning;
- policy registration;
- pass minting;
- treasury allowance;
- number of wallet confirmations;
- the current action that the wallet will review.

The primary action advances one real Mainnet stage at a time. Technical class
hash and calldata exports stay collapsed by default. After deployment, the
operator link contains only the public capability-token identifier.

Draft and estimate states must never appear as deployed.

## 7. Deployment progress

Each step has a verified state:

- Not started.
- Awaiting wallet.
- Submitted.
- Confirming.
- Verified.
- Failed.

Reloading resumes only from confirmed receipts stored for the exact mandate
inputs. A cancelled wallet request must not mark a step complete.

## 8. Organization dashboard

Default view shows real policies controlled by the connected organization.

Sections:

- Active mandates.
- Expired or revoked mandates.

Each mandate card shows:

- recipient and asset;
- per-use cap;
- total, used, and remaining public budget;
- expiry and mode;
- pass supply and public use count;
- verified deployment state.

Empty state directs the user to create a mandate. It must not show sample data
as if it belongs to the connected wallet.

## 9. Mandate detail and history

The detail page provides:

- policy summary;
- contract addresses;
- remaining budget;
- public uses;
- expiry and revocation status;
- verified deployment, issuance, and exercise receipts;
- explorer links;
- Issue pass and Export actions. The operator link appears after successful
  private delivery.

History may show public issuance transactions but must not claim a private note
owner based solely on public state.

## 10. Issue a pass

The issuer selects a mandate and reviews:

- operator receiving wallet;
- capability amount;
- policy constraints;
- current public pool fee;
- required token allowances.

The wallet performs the supported native STRK20 delivery route. A returned hash
means submitted, not completed. Studio waits for a successful receipt.

## 11. Share holder link

Studio generates a policy-specific link:

```text
/studio/use?policy=<public-policy-id>
```

The issuer shares the link with the operator through its normal communication
channel. The link identifies the public policy; it is not itself a private key
or capability.

## 12. Holder experience

The holder connects the wallet that received the pass.

Possible states:

- Connect wallet.
- Checking permission.
- Permission available.
- No pass available.
- Policy expired.
- Policy revoked.
- Awaiting confirmation.
- Confirming onchain.
- Action completed.
- Action failed.

The holder sees no mandate details until its wallet successfully prepares the
private-pass proof. It then sees the asset, recipient, cap, expiry, and mode
before confirmation. Studio never displays a fabricated private inventory.
