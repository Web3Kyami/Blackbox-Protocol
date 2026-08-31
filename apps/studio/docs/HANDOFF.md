# BlackBox Studio continuation handoff

**Last updated:** 2026-08-31

## Read first

Read `AGENTS.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, and
`docs/REUSE_MAP.md`. Work only inside `apps/studio/`. Do not rebuild BlackBox
contracts and do not broadcast a Mainnet action without explicit owner approval.

## Current journey

1. Treasury connects a compatible Starknet Wallet API wallet on Mainnet.
2. Treasury sets the public recipient, STRK cap, total budget, pass supply,
   behavior, and expiry.
3. Treasury acknowledges the public/private boundary.
4. Treasury confirms four Mainnet stages, one wallet prompt at a time.
5. Treasury enters the operator wallet, approves one pass plus the separate pool
   fee, waits for block freshness, and privately delivers the pass.
6. Studio shares `?policy=<capability-token-address>`.
7. Operator connects the wallet that received the private pass.
8. Studio prepares the fixed action through the wallet; details fail closed if
   proof preparation fails.
9. Operator requests an amount no greater than the cap or remaining budget.

## Recovery behavior

- Deployment progress: `blackbox.studio.mainnet.deployment.v1`.
- Confirmed mandates: `blackbox.studio.mainnet.mandates.v1`.
- Delivery progress: `blackbox.studio.mainnet.delivery.v1:<token>`.
- Holder confirmation progress: `blackbox.studio.mainnet.holder.v1:<token>`.
- Public draft fields are stored with incomplete deployment progress. No proof,
  private note, credential, or key is stored.
- A submitted hash is pending, never success. On retry, Studio waits for that
  receipt instead of resubmitting the same action.

## Primary files

- `src/sdk/mainnet-actions.mjs`: deploy, setup, delivery, proof, exercise, and
  receipt-safe resumption.
- `src/ui/app.mjs`: product state, persistence, dashboard refresh, and handlers.
- `src/ui/wizard.mjs`: validated creation and staged activation.
- `src/ui/pass-delivery.mjs`: issuer delivery and recovery.
- `src/ui/holder.mjs`: fail-closed operator flow.
- `test/product-controls.test.mjs`: dead-control regression coverage.
- `test/mainnet-product.test.mjs`: Mainnet amount/address regressions.

## Current verification

- Production: `https://blackbox-studio-phi.vercel.app`.
- The production HTML, application bundle, stylesheet, and operator query route
  return HTTP 200.
- Studio verify: passed, 9 test files.
- Studio preview build: passed.
- `vercel.json` builds the self-contained `preview/` output. Set the Vercel root
  directory to `apps/studio`; no generated bundle needs to be committed.
- Overview and shared operator-link output rendered successfully in headless
  Chromium from the self-contained deployment artifact.
- No Mainnet transaction was sent during the audit.
- Real Studio wallet orchestration and two-wallet rejection remain `UNVERIFIED`.

## Immediate continuation

Perform one controlled Mainnet walkthrough on the production URL. Do not
redesign or change contracts while testing. Record any wallet/RPC error exactly,
without secrets.
