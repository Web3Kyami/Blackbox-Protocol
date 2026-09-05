# Testing

## Repository checks

```sh
npm run verify
```

This runs formatting checks, JavaScript syntax checks, Node tests, all Studio
tests, the production build, and the secret scan.

## Cairo contracts

```sh
cd contracts
scarb build
snforge test
```

The contract tests cover:

- pool-only Gatekeeper access;
- exact target and selector enforcement;
- per-payment limit enforcement;
- expiry and revocation;
- stale delivery and replay rejection;
- one-shot burning and reusable pass return;
- direct adapter-call rejection;
- fixed-recipient treasury payment;
- treasury allowance exhaustion.

## STRK20 integration

```sh
BLACKBOX_PRIVACY_REPO=/absolute/path/to/starknet-privacy npm run verify:capability
```

The integration test deploys a local STRK20 pool and BlackBox contracts,
deposits a pass, exercises reusable and one-shot policies, rediscovers the
returned reusable note, and checks that the outside-execution sender differs
from the holder.

The selected Starknet Privacy checkout must already contain its built SDK,
privacy contract artifacts, discovery service, and E2E dependencies.
