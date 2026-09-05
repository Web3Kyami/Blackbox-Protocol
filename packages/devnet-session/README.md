# STRK20 integration test

This package runs the BlackBox capability flow against a local STRK20 pool.

From the repository root:

```sh
BLACKBOX_PRIVACY_REPO=/absolute/path/to/starknet-privacy npm run verify:capability
```

The selected Starknet Privacy checkout must have its SDK, Cairo contracts,
discovery service, E2E dependencies, and required Devnet binary built first.

The test covers private pass deposit, reusable use and rediscovery, one-shot
burning, Gatekeeper execution, and relay-sender separation.
