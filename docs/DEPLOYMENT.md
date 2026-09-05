# Deployment

BlackBox Studio provides the normal deployment path. It submits one wallet
confirmation at a time and stores only public progress needed to recover after
a refresh.

## Contract order

1. Declare `CapabilityGatekeeper`, `CapabilityToken`, and
   `TreasurySpendAdapter` if their classes are not already declared.
2. Deploy the Gatekeeper with the STRK20 pool address.
3. Deploy the adapter with the Gatekeeper, treasury, asset, and recipient.
4. Deploy the capability token with its name, symbol, issuer, pool, and
   Gatekeeper.
5. Register the payment policy, approve the total treasury budget, and mint the
   configured pass supply.
6. Approve the capability token and current STRK20 pool fee, then use the
   wallet-native STRK20 route to deliver a pass.

## Unsigned release bundle

Developers can also prepare a deterministic public deployment plan:

```sh
cd contracts
scarb build
snforge test
cd ..

npm run release:capability -- \
  --config configs/capability-deployment.example.json \
  --out dist/capability-release.json
```

The release command validates public configuration and hashes the contract
sources and compiled artifacts. It does not use an account or submit a
transaction.

Never place a signer, private key, seed phrase, viewing key, or wallet log in a
deployment config. Review all class hashes, constructor values, allowances,
and wallet fees before signing.
