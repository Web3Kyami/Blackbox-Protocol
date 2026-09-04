# BlackBox Studio continuation handoff

**Last updated:** 2026-09-02

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
- A confirmed holder hash is retained locally. On refresh, Studio verifies that
  receipt and restores the completed view without preparing or sending another
  payment.
- Mandate discovery is read-only and onchain. Studio scans Mainnet UDC events
  for CapabilityToken contracts deployed by the connected treasury, then reads
  their Gatekeeper, adapter, and policy state. Browser storage is only a cache
  for incomplete deployment and private-delivery progress.

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
- The real contract and STRK20 path passed locally on Devnet. This verifies the
  protocol path and local integration, not Studio's Mainnet wallet journey.
- Remaining budget now reads the current ERC-20 allowance without subtracting
  total spending twice. Confirmed and pending holder payments recover by hash
  without automatic resubmission.
- Wizard field edits now refresh the summary and Continue button immediately
  while preserving focus and caret position.

## Immediate continuation

Studio mandate `BBXS-20260910-001` is active. Its private-pass delivery
transaction is
`0x1515b9301e56fe3f68f7cd2b778bc94bc159601535d8f48fc1c618ef4a166f8`,
verified `SUCCEEDED` and `ACCEPTED_ON_L1` at block `14262867`. Reload the delivery
page to recover step 4 and copy the operator link. The next network write is the
operator's `0.01 STRK` holder exercise, which remains `UNVERIFIED` and requires
the owner's explicit fee and action approval before confirmation.

On Sep 3, the copied operator link briefly reported no active policy. Direct
read-only checks through Lava and PublicNode both resolved the linked token to
the active Studio mandate with `0.03 STRK` remaining and zero uses. The actual
UI defect was that runtime addresses from the older reference deployment
overrode the linked token's own Gatekeeper and adapter. Holder loading now
derives those addresses and the asset exclusively from the token's onchain
wiring; runtime configuration supplies only the read RPC. Studio also fails
over between two public RPCs. Phone and tablet layouts were
audited; the mobile navigation overlay and narrow-content overflow were fixed.
The preview now emits one stable `app.mjs`, so a rebuild cannot remove a lazy
flow module needed by an open wallet session. Pre-fix tabs need one hard refresh.

The holder amount field is now editable and defaults to the policy maximum.
Smaller positive amounts are accepted; malformed, zero, above-cap, and
above-budget values fail inside Studio before wallet submission. Errors remain
inline and preserve the checked permission state. Studio prefetches the public
policy, while Ready's private-note proof stage remains wallet-owned and can
take 5 to 10 seconds.

The responsive cascade was consolidated after the Authority Ledger visual
layer. Every main product surface now has an explicit tablet and phone layout,
with rendered checks at 320, 390, 768, and 1024 pixels. Do not add an earlier
media query and assume it wins; extend the final responsive section instead.
The operator page now says `Request an approved payment` and omits internal
terminal/link labels and the repeated instructional checklist.

## Sep 4 payment-completion hardening

The final operator path now preserves a successful receipt even if the
immediate allowance refresh is unavailable. It never renders the pre-payment
allowance as an updated value: the remaining allowance appears only after a
fresh post-payment read. In both cases the completed screen keeps the explorer
link and removes the payment action. Saved completed and pending hashes are
checked by receipt on reload, without automatic resubmission.

Automated tests and the Studio preview build pass. No Mainnet transaction was
sent. The future demo transaction is still the only valid way to mark the
Studio-created holder exercise as Mainnet verified.

## Sep 4 refresh recovery

Studio now checkpoints public workflow context in
`blackbox.studio.ui.recovery.v1`. An accidental refresh restores the active
screen, wizard step, public form, plan, and selected mandate. Wallet authority
is never restored or stored, so the user reconnects and continues from that
screen.

Before a holder wallet opens, Studio saves the requested amount plus the public
use count and total spending. If the transaction is broadcast but its callback
is lost, Studio verifies the advanced counters, matches the adapter's
`TreasurySpent` event, checks the receipt, and restores completion. If the
counters changed but receipt recovery fails, another payment remains blocked.
Read-only recovery uses two public Mainnet RPC endpoints.

Studio verification now passes with 10 test files. No wallet request, Mainnet
transaction, or STRK spending occurred during this hardening.
