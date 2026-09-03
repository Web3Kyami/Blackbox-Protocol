# BlackBox Studio status

**Last updated:** 2026-09-02, completion and recovery audit

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

## Completion and recovery audit

- Corrected remaining budget to use the ERC-20 allowance as it exists now. A
  successful `transfer_from` already reduces that allowance, so Studio no longer
  subtracts historical spending a second time.
- Added a successive-payment regression covering an initial allowance followed
  by three payments. The displayed remainder now moves from three units to two,
  one, and zero.
- Persisted a confirmed holder payment separately from a pending payment. After
  refresh, Studio verifies the saved receipt and restores the completion screen
  instead of preparing or submitting another payment.
- A pending or rejected saved transaction is checked by hash only. Studio never
  replaces it automatically with a new payment.
- The completion screen removes the payment button, links to the confirmed
  transaction, and shows the latest readable treasury allowance.
- Generated `.vercel` metadata is excluded from source formatting checks. Real
  source files remain fully checked.
- The real BlackBox capability flow passed locally on Devnet using the contract
  artifacts and STRK20 path: deploy, shield, private pass delivery, reusable
  exercise, and rediscovery.
- Fixed the configuration form's stale Continue state. Each edit now refreshes
  validation and the mandate summary immediately, then restores the active
  field and caret so typing remains uninterrupted.
- Contained long class hashes and constructor calldata inside the optional
  developer-details panel. The deployment rail no longer widens the page or
  creates horizontal overflow.
- Fixed the pass-delivery recipient field so the operator card and approval
  step update immediately after typing or pasting an address.
- Prevented local preview rebuilds from deleting hashed modules still used by
  an open browser tab. The local server also marks preview responses as
  `no-store`, so a refresh loads the matching application bundle.
- Replaced browser-local mandate discovery with read-only Mainnet discovery.
  Studio now scans UDC deployment events for CapabilityToken contracts created
  by the connected treasury, then resolves each mandate from its own contracts.
  Browser storage remains only a cache for local delivery progress.
- Removed the repeated page-entry animation from interactive Studio screens.
  Typing now refreshes validation without replaying a full-card animation.
- Pass delivery now rechecks both the capability-token allowance and current
  STRK20 fee allowance on every open. A saved approval cannot remain visibly
  approved after either allowance is missing.
- Successful pass delivery is now recovered from the capability token's public
  treasury-to-pool transfer event and its successful receipt. A browser that
  missed the wallet response restores step 4 instead of offering another
  approval or delivery.

No Mainnet transaction was requested, signed, or broadcast during this audit.

## Studio Mainnet walkthrough progress (2026-09-03)

- Studio created active mandate `BBXS-20260910-001` with capability token
  `0x5a6f72f73e419febf986dc26707ee29046131b84548aebf19e5a69382b9f9ef`.
- Read-only Mainnet checks confirm a `0.01 STRK` cap, `0.03 STRK` remaining
  treasury allowance, reusable behavior, zero uses, and the configured
  recipient ending in `991c6`.
- Private-pass delivery transaction
  `0x1515b9301e56fe3f68f7cd2b778bc94bc159601535d8f48fc1c618ef4a166f8`
  is `SUCCEEDED` and `ACCEPTED_ON_L1` at block `14262867`.
- Studio can now recover that delivery from the public capability-token deposit
  event and receipt when a wallet callback or browser state is missing.
- The Studio-created holder exercise remains `UNVERIFIED`. Do not describe the
  complete Studio Mainnet walkthrough as verified until that payment succeeds
  and its updated allowance is read back.

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
- Local real-contract capability verification: passed, 1 end-to-end Devnet test.

## UNVERIFIED

- A funded wallet has not exercised Studio's new Mainnet orchestration from end
  to end. The underlying BlackBox Mainnet flow is previously verified, but this
  Studio wiring must still be tested one confirmation at a time.
- Wrong-wallet rejection must still be confirmed with two real STRK20-capable
  wallets.
- A Studio-created mandate has not yet completed deployment, private delivery,
  and holder payment on Mainnet. The older reference BlackBox flow is verified
  Mainnet evidence, not evidence for this new Studio journey.

## Next action

Open the copied operator link with the operator wallet and check its private
pass. Studio now retries read-only Mainnet policy calls through a second public
RPC if the primary endpoint fails. The policy linked by token `0x5a6f...f9ef`
was independently read through both endpoints on Sep 3 and is active. Holder
loading now ignores unrelated reference Gatekeeper and adapter defaults and
derives the complete contract graph from that token. Stop
before confirming the `0.01 STRK` holder exercise so its current fee can be
reviewed and approved. Do not approve a second payment merely to repeat the
video.

Responsive rendering was checked at phone and tablet widths. The phone bottom
navigation no longer covers the page or hides Create mandate, narrow operator
content fills the available width, and long wallet or policy values wrap.

The preview build now emits one stable application module. This removes the
missing hashed-module failure seen in an open operator tab after a rebuild.
Existing pre-fix tabs need one hard refresh to load the stable module.

The operator payment form now supports any positive amount up to the lower of
the policy cap and remaining budget. It defaults to that maximum, preserves the
field and cursor while editing, and shows validation or wallet errors inline
without discarding the verified permission state. Public policy data is
prefetched from the link; wallet-owned note discovery and proof preparation may
still take 5 to 10 seconds.

Studio now has one final responsive system after both historical style layers.
It covers the home, navigation, mandate wizard, review rail, treasury dashboard,
mandate detail, private-pass delivery, holder payment, and wallet dialog.
Rendered audits passed at 320, 390, 768, and 1024 pixels. The 768-pixel home is
now a readable single-column composition, mobile navigation keeps all four
destinations, and financial controls meet a 44-pixel minimum touch target.
The holder screen no longer exposes internal `Operator link` or `Operator
terminal` labels and no longer repeats a four-step guide before its action.
