# Contributing to BlackBox Protocol

BlackBox is a Starknet protocol primitive. Changes to its privacy claims and
authorization path need evidence, not optimistic copy.

## Before opening a change

1. Read [`docs/VNEXT_PROTOCOL.md`](docs/VNEXT_PROTOCOL.md),
   [`docs/PRIVACY_MODEL.md`](docs/PRIVACY_MODEL.md), and
   [`docs/NETWORKS.md`](docs/NETWORKS.md).
2. Do not add a signer, viewing key, mnemonic, credential, note plaintext, or
   prompt/strategy material to source, fixtures, browser storage, or logs.
3. Do not describe a STRK20 deposit as private: its depositing address, token,
   and amount are public.
4. Keep policy enforcement in Cairo. The SDK and web app may validate and
   display policy data, but must not become the authority.

## Verification

Run the fast product gate before handing off a change:

```sh
npm run verify
```

For a prepared local Starknet Privacy checkout, also run:

```sh
npm run verify:capability
```

`npm run verify:mainnet-readiness` is a read-only check of mainnet identity and
the live STRK20 pool class hash. It is not deployment approval. Never sign,
declare, deploy, or broadcast on mainnet without the owner’s explicit approval.

## Contract changes

For a new protected target, add an adapter with fixed dependencies wherever
possible, then test at least: wrong caller, wrong target/selector, over-limit,
expired policy, revoked policy, replay, and a preloaded token delivery from an
earlier transaction. Update `docs/STATUS.md` with the exact evidence and mark
any untested network or privacy claim `UNVERIFIED`.
