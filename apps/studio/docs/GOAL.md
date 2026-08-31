# Studio goal

## Product objective

Build a user-first self-service application that allows a Starknet protocol
team to configure, deploy, fund, issue, monitor, and share a Private Treasury
Mandate without manually assembling BlackBox contracts.

## The problem

A protocol may need an operator to trigger an approved treasury payment without:

- giving the operator a general treasury key;
- putting a permanent operator wallet in a public role list;
- allowing the operator to change the asset or recipient;
- allowing an unlimited payment;
- relying on an offchain promise for enforcement.

## The solution

Studio guides the protocol team through a contract-enforced mandate containing:

- treasury wallet;
- payment asset;
- pre-approved recipient;
- maximum amount per payment;
- total approved budget;
- pass supply;
- reusable or one-shot behavior;
- expiry;
- clear issuer, payment-recipient, and later permission-holder roles.

The resulting capability is privately held through STRK20. The policy and final
onchain action remain public.

## Definition of success

Studio is successful when a new protocol team can understand and complete this
journey without reading developer documentation first:

1. Connect its Starknet wallet.
2. Configure a valid Treasury Mandate.
3. Understand exactly what will be public and private.
4. Review a deterministic deployment and funding plan.
5. Submit wallet-reviewed deployment transactions when authorized.
6. Verify deployed state onchain.
7. Issue a pass to an operator.
8. Monitor public policy state and history.
9. Share a policy-specific holder link.
10. Let the holder review and exercise only the permitted action.

## What success does not mean

- A clickable mockup with fake organizations or transaction history.
- Arbitrary contract execution disguised as a safe mandate.
- Claiming Mainnet deployment before a verified receipt exists.
- Reading or storing private notes on a Studio server.
- Rebuilding or modifying the existing BlackBox reference product.

## Product sentence

> BlackBox Studio lets protocol teams create contract-enforced private treasury
> mandates without manually deploying and wiring the underlying capability
> infrastructure.
