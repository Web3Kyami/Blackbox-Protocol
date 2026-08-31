# BlackBox Studio status

**Last updated:** 2026-08-31, release-blocker flow audit

## Current product

BlackBox Studio is a Mainnet self-service interface for one functional template:
Private Treasury Mandate.

> Connect treasury wallet → set payment rule → confirm privacy boundary → deploy
> and fund → deliver private pass → share operator link → operator proves pass →
> request payment.

The payment recipient is fixed in the payment contract. The operator is a
separate person selected only when the treasury privately delivers a pass.

## Release-blocker audit completed

- Audited overview, wallet selection, mandate wizard, deployment review,
  treasury workspace, mandate detail, pass delivery, shared operator link,
  wrong-wallet handling, payment request, error, confirmation, and recovery.
- Connected every operator input and button to a real browser event. The former
  `data-action`-only controls could render without responding to clicks.
- Added a product-control regression test covering every visible enabled button,
  input, and select across all active screens.
- Continue now requires valid fields for the current wizard step.
- Zero addresses and holder amounts outside cap or remaining budget fail before
  a wallet transaction is requested.
- Wallet switching and disconnecting clear holder-only policy state. A wrong
  wallet cannot retain previously revealed controls.
- A failed public policy read is no longer reported as a missing private pass.
- Dashboard records saved by Studio are refreshed from their deployed contracts,
  so uses and remaining budget do not remain stale after a payment.
- Incomplete deployment data, delivery approval, pass delivery, and holder
  payment hashes are persisted locally. A timeout or refresh resumes receipt
  confirmation rather than blindly submitting the action again.
- Deployment progress also stores the public mandate draft, allowing safe
  recovery after refresh.
- Successful pass delivery is persisted on the mandate. Operator-link sharing
  remains available after refresh and includes a manual-copy fallback.
- Wallet discovery accepts any compatible Wallet API provider instead of
  excluding wallets by brand name.
- The separate STRK20 pool fee is stated before pass approval.
- Added a favicon and simplified user-facing labels and technical disclosure.
- Made `preview/` a self-contained deploy artifact and added Studio-local Vercel
  build/output configuration. A fresh checkout no longer depends on committed
  generated files or manual output-directory settings.
- Removed stale active references to Sepolia and dry-run behavior from the
  current product status. Historical decision and setback records remain history.

No transaction was signed or broadcast during this audit.

## Verification

- Production deployment: `https://blackbox-studio-phi.vercel.app`.
- Public HTML, application bundle, stylesheet, and `?policy=` route: HTTP 200.
- Studio `npm run verify`: passed, 9 test files.
- Studio `npm run build:preview`: passed.
- Chromium overview render at 1440×1000: passed.
- Chromium shared operator-link render at 1280×900 from the exact self-contained
  Vercel output: passed after correcting a DOM tree-shape defect.
- Repository-root `npm run verify`: passed, including format, lint, type checks,
  root tests, production build, and secret scan.

## UNVERIFIED

- A funded wallet has not exercised Studio's new Mainnet orchestration from end
  to end. The underlying BlackBox Mainnet flow is previously verified, but this
  Studio wiring must still be tested one confirmation at a time.
- Wrong-wallet rejection must still be confirmed with two real STRK20-capable
  wallets.

## Next action

Run one controlled Mainnet walkthrough on the production URL. Review the
contract, amount, and recipient in every wallet prompt. Stop after any unexpected
prompt; do not approve a second payment merely to repeat the video.
