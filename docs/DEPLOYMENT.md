# Capability deployment handoff

BlackBox provides an **unsigned** release bundle. It hashes the exact Cairo
sources and Sierra/CASM artifacts, validates the public treasury configuration,
and produces a dependency-ordered plan. It has no account, signer, credential,
RPC submission, or transaction-broadcast code.

## Prepare a bundle

1. Build and test the exact sources:

   ```sh
   cd contracts
   scarb build
   scarb test
   cd ..
   npm run verify
   ```

2. Copy `configs/capability-deployment.example.json` and replace every example
   address and value. Configuration is public. Never add a private key,
   mnemonic, viewing key, signer, or credential.
3. Verify the live STRK20 pool address and the matching Wallet API/SDK, proving,
   discovery, and relay path. `docs/NETWORKS.md` records a read-verified mainnet
   address and class hash, but no BlackBox transaction has exercised it.

   ```sh
   npm run verify:mainnet-readiness
   ```

   This is read-only: it verifies `SN_MAIN` and the expected pool class hash.
   It cannot prove a wallet/relayer path and does not authorize a transaction.
4. Generate the deterministic handoff:

   ```sh
   npm run release:capability -- \
     --config configs/capability-deployment.example.json \
     --out dist/capability-release.json
   ```

5. Independently recompute the listed artifact hashes and class hashes, then
   simulate every declaration, deployment, and setup call against the selected
   network state.

## Ordered deployment

The generated plan requires confirmed addresses between stages:

1. Declare `CapabilityGatekeeper`, `CapabilityToken`, and
   `TreasurySpendAdapter` from the hashed artifacts.
2. Deploy the Gatekeeper with the verified STRK20 pool.
3. Deploy the treasury adapter with the confirmed Gatekeeper plus the fixed
   treasury, ERC-20 asset, and recipient.
4. Deploy the capability token with issuer, pool, and confirmed Gatekeeper.
5. Register the `spend(amount)` policy, approve the adapter from the treasury,
   and mint passes to the issuer. The issuer then publicly approves the STRK20
   pool and uses a compatible wallet to deposit the passes into private notes
   before distributing them. Minting tokens directly to the pool does not by
   itself create a private note.

For reusable passes, the per-use maximum is not a lifetime maximum. Set and
monitor the treasury allowance deliberately; rotate or revoke the capability
class when its operational mandate ends.

## Mainnet approval gate

Generating or reviewing a bundle is not deployment authorization. Before any
mainnet signature, the owner must explicitly approve the final network,
accounts, source and artifact hashes, computed class hashes, constructor values,
policy, allowance, fee bounds, relay, monitoring, and rollback/revocation plan.

Mainnet deployment and its privacy behavior remain `UNVERIFIED`. The browser
Wallet API flow is wired and fails closed without a compatible wallet, but it
still needs a real extension, deployed policy, and receipt-level sender
verification on the target network. Direct holder submission exposes the holder
as transaction sender; the production flow needs a tested relay/outside-
execution path.
