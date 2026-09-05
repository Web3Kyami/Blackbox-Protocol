# Architecture

BlackBox has three onchain components and two client surfaces.

```text
Treasury
  ├─ defines a public policy in CapabilityGatekeeper
  ├─ approves a fixed budget to TreasurySpendAdapter
  └─ deposits CapabilityToken passes into STRK20

Operator wallet
  └─ spends one private pass through STRK20
       └─ CapabilityGatekeeper validates the action
            └─ TreasurySpendAdapter pays the fixed recipient
```

## CapabilityToken

Each base unit represents one bearer pass. The token is permanently connected
to its issuer, STRK20 pool, and Gatekeeper.

When the pool transfers a pass to the Gatekeeper, the token records the current
transaction hash and delivered amount. The Gatekeeper consumes that marker in
the same transaction. A pass sent earlier cannot be reused as authorization.

## CapabilityGatekeeper

The Gatekeeper accepts `privacy_invoke` only from its configured pool. A policy
binds one capability token to:

- target contract;
- target selector;
- optional maximum first argument;
- expiry;
- one-shot or reusable behavior;
- active or revoked status.

The Gatekeeper checks the fresh pass delivery before forwarding the call. A
one-shot pass is burned. A reusable pass is returned to the pool as a new note.

## TreasurySpendAdapter

The adapter fixes the Gatekeeper, treasury, ERC-20 asset, and recipient in its
constructor. Its only holder-controlled input is `spend(amount)`.

The treasury gives the adapter a normal ERC-20 allowance. That allowance is the
total remaining payment budget. It falls after every successful payment, so the
adapter cannot pay beyond the amount the treasury approved.

## Clients

BlackBox Studio handles configuration, deployment, pass delivery, public policy
discovery, and recovery from pending transactions. The holder flow prepares and
submits the STRK20 action through a compatible wallet.

The browser never receives a private key, viewing key, private note, or proof.
Wallet software owns private note discovery and proving.
