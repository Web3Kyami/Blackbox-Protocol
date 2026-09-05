# BlackBox contracts

The Cairo package contains the protocol contracts and their test fixtures:

- `CapabilityGatekeeper`
- `CapabilityToken`
- `TreasurySpendAdapter`
- `MockCapabilityTarget`
- `MockPrizeToken`

Build and test with:

```sh
scarb build
snforge test
```

`MockCapabilityTarget` and `MockPrizeToken` are test contracts. They are not
part of the Mainnet deployment.
