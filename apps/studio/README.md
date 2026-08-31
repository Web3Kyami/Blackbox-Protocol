# BlackBox Studio

BlackBox Studio is the self-service product layer for BlackBox Protocol.

It is being developed as an isolated application inside the existing repository.
It does not modify the verified BlackBox reference product or Mainnet policy.

## Clear product goal

Enable a Starknet protocol team to create and operate a Private Treasury
Mandate through a guided interface:

> Connect → configure → review → deploy and fund → deliver → share → request payment.

A Private Treasury Mandate gives an operator a privately held bearer permission
to request a capped payment to a pre-approved recipient. It does not give the
operator a general treasury key.

## Primary user

The primary user is a protocol, DAO, vault, or onchain treasury team.

Developer integration is important but secondary. The first screen must explain
what the protocol team can accomplish, not lead with SDKs, class hashes, or
calldata.

## Product boundaries

- One functional mandate: Private Treasury Mandate.
- Existing BlackBox contracts and SDK may be studied and copied.
- Existing application files must not be edited.
- Studio exposes real Mainnet actions, each reviewed and approved in the
  connected wallet. No action runs automatically.
- No simulated success or fake private history.

## Documentation map

- [`docs/GOAL.md`](docs/GOAL.md): outcome and definition of success.
- [`docs/USER_FLOW.md`](docs/USER_FLOW.md): page-by-page user experience.
- [`docs/UI_DIRECTION.md`](docs/UI_DIRECTION.md): researched visual system and screen patterns.
- [`docs/REUSE_MAP.md`](docs/REUSE_MAP.md): mandatory existing protocol, SDK, artifact, and wallet-flow reuse.
- [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md): functional and safety requirements.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md): phased build order and gates.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): durable product and architecture decisions.
- [`docs/STATUS.md`](docs/STATUS.md): verified progress, blockers, and next action.
- [`docs/HANDOFF.md`](docs/HANDOFF.md): continuation context for another model.

Every model must read [`AGENTS.md`](AGENTS.md) before working in this folder.

Implementation belongs on `codex/blackbox-studio`. Direct pushes to the
existing product branch are prohibited, and any remote push requires explicit
owner approval.

Studio reuses the existing BlackBox Protocol. It does not build replacement
capability contracts or a second privacy integration.
