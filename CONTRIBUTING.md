# Contributing

BlackBox authorization is enforced by Cairo. The web apps and SDK can validate
inputs and explain the policy, but they must not become the source of authority.

## Before opening a change

- Read [the architecture](docs/ARCHITECTURE.md) and
  [privacy model](docs/PRIVACY_MODEL.md).
- Never commit a private key, seed phrase, viewing key, note plaintext, prover
  credential, or wallet log.
- Do not describe a STRK20 deposit as private. Its sender, token, and amount are
  public.
- Mark any untested network or privacy claim as `UNVERIFIED`.
- Keep every configurable payment field tied to a contract-enforced rule.

## Checks

```sh
npm install
npm run verify

cd contracts
scarb build
snforge test
```

For the real local STRK20 path:

```sh
BLACKBOX_PRIVACY_REPO=/absolute/path/to/starknet-privacy npm run verify:capability
```

Contract changes should cover wrong caller, wrong target, wrong selector,
over-limit payment, expiry, revocation, replay, and stale pass delivery.
