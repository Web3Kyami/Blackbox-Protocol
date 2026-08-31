# Product requirements

## Functional requirements

### Mandate configuration

- Validate Starknet addresses.
- Require nonzero per-use cap and total budget.
- Prevent per-use cap from exceeding total budget.
- Require a future expiry.
- Require positive pass supply.
- Support reusable and one-shot modes.
- Normalize configuration deterministically.
- Reject arbitrary calldata and unsupported target semantics.

### Deployment planning

- Reuse verified declared classes when compatible.
- Display class hashes and predicted addresses.
- Generate exact constructor and setup calls.
- Estimate fees where the wallet/RPC supports it.
- Export a public-only configuration.
- Store drafts without secrets.

### Transaction lifecycle

- Require wallet review for every write.
- Treat a transaction hash as submitted, not successful.
- Verify receipts and expected public state.
- Recover after refresh or cancellation.
- Never repeat a confirmed step automatically.

### Dashboard

- Derive deployed policy facts from RPC state.
- Distinguish browser-local drafts from onchain mandates.
- Show public history with explorer links.
- Never infer private note ownership from public events.

### Issuance and holder use

- Read current pool fee instead of hard-coding it.
- Use the supported wallet-native STRK20 route.
- Support dynamic policy and contract addresses.
- Generate policy-specific holder links.
- Prevent duplicate actions after verified completion when policy state requires it.

## User-experience requirements

- Explain the outcome before technical implementation.
- Keep one primary action per step.
- Use plain language for wallet confirmations.
- Provide clear empty, loading, failure, and recovery states.
- Work on desktop and mobile.
- Keep developer details collapsed or in Help.
- Avoid internal release-stage and maturity labels in user-facing copy.

## Security requirements

- No private key, seed phrase, viewing key, note plaintext, auth token, or wallet
  log storage.
- No Mainnet write without explicit owner approval during development.
- Every user-configured semantic constraint must be enforced by contracts.
- No false claim that deposit/shielding is private.
- No fake receipt, address, balance, history, or success state.

## Initial non-goals

- Arbitrary contract calls.
- Multiple functional mandate templates.
- Username/password accounts.
- Centralized private-note inventory.
- Individual private-pass revocation without a supported privacy primitive.
- Editing the existing BlackBox product.
