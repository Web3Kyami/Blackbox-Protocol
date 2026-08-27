# Product

## Positioning

> **Public rules. Private operators.**

BlackBox is private access control for Starknet. Protocols publish exactly what
a capability permits, convert its bearer pass into a STRK20 private note through
a public deposit, and let the holder exercise that authority through relayed
execution without exposing the wallet behind it as the transaction sender.

The product is not a private multisig and does not control every action of a
personal shielded wallet. It protects protocol entrypoints that explicitly make
the BlackBox Gatekeeper their authority.

## Primary customer

Starknet protocols, DAOs, and treasuries that delegate operational authority to
contributors, keepers, guardians, trading desks, or short-lived contractors.

## Flagship job

A DAO gives an operator permission to call the included treasury payout adapter
up to a fixed amount before expiry. The adapter permanently binds the treasury,
asset, and recipient, so the holder controls only the amount. The payout remains
publicly auditable; relayed execution keeps the operator wallet out of the call
and transaction-sender metadata.

## Product surfaces

- **Administrator tooling:** the unsigned deployment plan, public policy-call
  builder, and issuer deposit action provide the create, issue, inspect, pause,
  and rotate workflow. The static web app currently previews policy data; it is
  not presented as a contract-deployment console.
- **Holder app:** discover a pass, inspect its limits and disclosure, and execute
  the permitted action.
- **Gatekeeper:** contract-owned target, selector, deadline, use-mode, and
  optional first-argument enforcement.
- **Capability token:** transaction-bound proof that one pass arrived from the
  configured STRK20 pool in the current callback.
- **SDK:** policy validation, invoke encoding, disclosure rendering, and
  integration helpers without viewing-key custody.

## Reference applications

1. Private treasury operator — flagship and demo.
2. Private protocol keeper — maintenance calls without a public keeper list.
3. Emergency guardian — short-lived, narrowly scoped pause authority.
4. One-shot execution mandate — one exact or adapted contract operation.
5. BlackBox Voice — verified anonymous signalling for onchain communities.

## Landing-page hierarchy

1. Hero: **Public rules. Private operators.**
2. Explanation: delegate limited onchain authority without exposing the wallets
   that receive or exercise it.
3. Three-step flow: define rules → deposit publicly and transfer privately → act through Gatekeeper.
4. Flagship capability card and Wallet API transaction demonstration.
5. Crypto-native use cases.
6. Exact hidden-versus-public table.
7. Builder SDK and contract integration.
8. Security limitations and open-source links.

## Business model

Contracts and the basic SDK remain open source. Paid surfaces can include hosted
policy management, indexing and discovery, monitoring, risk alerts, simulations,
audit exports, integrations, support, and enterprise SLAs. The hackathon build
does not introduce a mandatory protocol fee.

## Success measures

- A user understands the product in one sentence without learning Starknet.
- A protocol can integrate one protected operation from the README.
- Allowed actions work; wrong target, selector, amount, expiry, caller, stale
  delivery, and replay paths fail in tests.
- A real STRK20 E2E demonstrates private issue and use without claiming the
  public deposit or public target action is hidden.
- The code is useful as infrastructure beyond the reference interface.

The complete protocol and privacy specification is in
[`VNEXT_PROTOCOL.md`](./VNEXT_PROTOCOL.md). The old Arena dashboard and scoring
contracts are retained only as a verified prototype and migration reference.
