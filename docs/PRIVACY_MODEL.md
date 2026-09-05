# Privacy model

BlackBox uses STRK20 to keep capability ownership inside a private note. Cairo
enforces what that capability can do.

## Public information

- Gatekeeper, capability token, adapter, treasury, asset, and recipient;
- policy target, selector, cap, expiry, mode, and active status;
- shielding or deposit address, token, and amount;
- action calldata, timing, payment, and resulting state change;
- policy use count and remaining treasury allowance.

## Information kept inside the wallet

- capability note ownership;
- note plaintext;
- viewing keys;
- proof material;
- private note selection.

## Metadata limits

The intended privacy property is that a public observer cannot directly connect
the delivered pass with the wallet that later spends it. This depends on the
STRK20 note system and the wallet's relay path.

Direct proof submission can expose the operator as the transaction sender.
Timing, IP, RPC, browser, wallet, prover, and relayer metadata can also create
correlations. BlackBox does not claim full anonymity or hidden treasury
activity.

The operator link contains a public capability-token address. It is not a
secret and does not grant authority without the private pass.
