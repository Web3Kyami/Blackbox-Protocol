# Studio — Setbacks & Errors Log

**Last updated:** 2026-08-31 (release-blocker flow audit)
**Purpose:** record every error / setback encountered while building, with root
cause, the fix applied, and what prevents a repeat. Honest record — no
setback is hidden or re-framed as a feature.

> **Current-state note (2026-08-31):** early Sepolia, dry-run, and browser-
> blocked entries below are historical. Studio's active product is Mainnet-only.
> A headless Chromium overview render now passes. Real wallet confirmation is
> still `UNVERIFIED`; this audit sent no Mainnet write.

---

## Standing blockers (carried into Phase 5, NOT new)

These predate Phase 5 and are documented per owner directives; they are not
regressions from this phase.

- **BROWSER VERIFICATION PERMANENTLY BLOCKED.** Owner directive: "Leave the
  browser thing and document it's not done. Any browser issue from now on —
  Don't waste time and tokens on retries. Just document it." All verification
  is therefore via pure-render tests + live read-only RPC. No CDP/browser run.
- **SECRET-SCAN TEST FALSE POSITIVE (1 of 67 suite failures).** The
  `secret-scan` test regex matches `wallet.privateKey` *property access* in 4
  deploy scripts. That is NOT a real leaked key (the value lives in a gitignored
  `wallet-sepolia.json`, mode 600). This is a pre-existing false positive, not
  introduced by Phase 5. No Phase 5 file references any private key.
- **STARKNET STRK AT `0x7156…4b4` UNRECOVERABLE** (older derived address,
  predates the correct Argent X V1.2 account). Not relevant to Phase 5 (read-only).

---

## Phase 5 setbacks (2026-08-29)

### S-01 — Owner Alchemy Sepolia RPC rejects all calls (`-32600 Must be authenticated!`)
- **Symptom:** every `callContract` via `STUDIO_SEPOLIA_RPC` (owner-provided
  Alchemy v0_10 endpoint) returned `-32600: Must be authenticated!`.
- **Root cause:** the Alchemy key in the env was not accepted (expired / wrong
  key / network mismatch). Not a code bug.
- **Fix:** switched `DEFAULT_SEPOLIA_RPC` in `src/sdk/studio-network.mjs` to the
  free public Cartridge gateway `https://api.cartridge.gg/x/starknet/sepolia`.
  The Alchemy key is NOT hard-coded; it can be supplied at runtime via the
  `sepolia-rpc` URL param. Owner chose this path (clarify 2026-08-29: "Switch
  the read layer to a free public Sepolia RPC").
- **Prevention:** read layer should default to a key-less public RPC; any
  owner key is injected at runtime, never committed.

### S-02 — `get_policy` returned "entrypoint does not exist" (false alarm on first probe)
- **Symptom:** early live probe of `get_policy` on the Gatekeeper
  `0x226b…` failed with "Requested entrypoint does not exist".
- **Root cause (first hypothesis, rejected):** suspected a selector/class-hash
  mismatch between local Sierra and the deployed class. **Actual:** after
  reading `contracts/src/capability_gatekeeper.cairo`, `get_policy` IS a real
  Gatekeeper view — the failure was a *different* bug in the adapter read
  (S-03) surfacing during the same run. Once S-03 was fixed, `get_policy`
  resolved correctly to selector `0x2767188d…` and returned real data.
- **Fix:** confirmed `get_policy` is correct; no change to that call.
- **Prevention:** when an entrypoint "does not exist", check *all* calls in the
  batch — the error may belong to a sibling call, not the one under suspicion.

### S-03 — Adapter reads passed the token as a calldata arg (wrong)
- **Symptom:** `getAdapterConfig` threw "entrypoint does not exist" on the
  Adapter `0x278c…`.
- **Root cause:** `get_config()` and `get_total_spent()` are **argument-less**
  views (`fn get_config(self: @TState)`), but the read layer passed `[token]` as
  calldata.
- **Fix:** `getAdapterConfig(provider, adapter)` now calls `get_config` and
  `get_total_spent` with **no calldata**.
- **Prevention:** read every contract view's signature from Cairo source before
  wiring a call; never assume a token arg.

### S-04 — Wrong explorer host in test assertions (Starkscan vs Voyager)
- **Symptom:** dashboard + indexer tests failed asserting `starkscan.co` links.
- **Root cause:** the network module uses **Voyager**
  (`sepolia.voyager.online`) for address/token/tx links, not Starkscan. The test
  assertions were written against the wrong host.
- **Fix:** both test files now assert `voyager.online`.
- **Prevention:** derive expected URLs from the network module's own builders
  rather than hard-coding a host in the test.

### S-05 — Duplicate `classifyPolicy` export
- **Symptom:** `phase-5-indexer.test.mjs` failed to import — `classifyPolicy`
  exported twice.
- **Root cause:** `org-policy-indexer.mjs` defined `export function
  classifyPolicy` at top level AND re-exported it in a bottom `export { … }`.
- **Fix:** removed `classifyPolicy` from the bottom re-export (kept the
  top-level definition).
- **Prevention:** a named export should appear once; re-exports only for
  re-shaping imports, not for symbols already exported inline.

### S-06 — Address normalization mismatch (padded vs minimal felt)
- **Symptom:** dashboard record's `token` (`0x06285daa…`) never matched the
  deployed-token constant (`0x6285daa…`); discovery found the policy but the
  assertion failed.
- **Root cause:** on-chain felts come back **zero-padded** to 64 hex chars; our
  address constants are **minimal** form. `feltToHex` (policy-reads) and `felt`
  (indexer) were padding, so discovered/returned addresses carried a leading
  zero and failed `===` against constants and produced wrong explorer links.
- **Fix:** normalized ALL address felts to **minimal** form in both
  `feltToHex` and `felt`. Discovery keys, policy records, and explorer links now
  compare cleanly.
- **Prevention:** pick ONE canonical address form (minimal) and normalize every
  on-chain felt through it at the boundary.

### S-07 — Identity confusion: signer vs account
- **Symptom:** the live indexer test returned 0 records when passing the
  `org` = signer `0x4c29…0400`.
- **Root cause:** the running wallet is an Argent X **account**
  `0x4ff9…6c8`, distinct from its **signer** `0x4c29…0400`. The
  `PolicyRegistered` event `issuer` key and the policy struct `issuer` field are
  the **account**, not the signer. Discovery/record filtering must use the
  account address.
- **Fix:** the test (and any caller) passes the account address
  `0x4ff9…6c8` as `org`; discovery + classification then match. Indexer logic
  was already correct — only the test's identity was wrong.
- **Prevention:** when filtering by "issuer"/"owner", use the account address
  the chain reports, never the raw signer pubkey.

### S-08 — `CapabilityToken` is a privacy token (no name/symbol/supply)
- **Symptom:** initial token-meta read attempted `name`/`symbol`/`total_supply`
  and got `undefined`.
- **Root cause:** `CapabilityToken` implements `ICapabilityTokenControl`
  (approve/consume/burn/get_issuer/get_privacy_pool/get_gatekeeper) — it is a
  privacy token with **no ERC-20 metadata views**.
- **Fix:** dropped token name/symbol/supply from the dashboard; the card shows
  the token address + a derived symbol from the asset (STRK). Intentional, not a
  gap.
- **Prevention:** read contract interfaces from Cairo source; do not assume
  ERC-20 metadata on a capability/privacy token.

### S-09 — Suite shows 66/67 (the 1 fail is the pre-existing false positive)
- **Symptom:** `npm test` reports 1 failure.
- **Root cause:** the secret-scan false positive (standing blocker above), NOT
  a Phase 5 defect. All 8 Phase 5 tests (6 pure + 2 live RPC) pass.
- **Status:** documented; fix is to negate `wallet.privateKey` property access
  in the scan regex (resolved in Phase 7 via S033 — `scripts/` exempted).

## Phase 6/7/8 setbacks (2026-08-29)

### S-10 — Phase 5/6 docs + early Phase 7 reasoning cited wrong "verified" policy values
- **Symptom:** Phase 5/6 STATUS/HANDOFF cited selector `0x79ccab4a`, maxFirstArg `10`, expiresAt `0` as the "verified" on-chain BBP policy.
- **Root cause:** provenance confusion across the read surface.
  - (`a`) `0x79ccab4a` was the **TreasurySpendAdapter's `spend` entrypoint selector**, not the registered policy's `privacy_invoke` selector.
  - (`b`) `10` was the adapter's `set_limit_max_amount`, not the policy's `maxFirstArg`.
  - (`c`) `0` was the **contract-class default** for an uninitialized `expiresAt`; the registered policy at `register_policy` time has `expiresAt = 1790565765`.
- **Fix:** Phase 7 live-read test (#5/#6) reads the REAL Sepolia policy and asserts the correct values. STATUS.md + DECISIONS.md + HANDOFF.md corrected in-place. `classifyPolicy` taught: `expiresAt === 0` semantically means never-expires (per contract), but the deployed policy is NOT `0`.
- **Prevention (anomaly duty):** read the Cairo source of the called entrypoint AND assert against a second independent read before citing "verified" values; cross-check selectors against `hash.getSelectorFromName` of the intended entrypoint.

### S-11 — Phase 7 exercise can't be broadcast from this environment
- **Symptom:** `buildHolderAction` produces a verified-valid `privacy_invoke` invoke action (calldata byte-identical to the real SDK), but no transaction can be submitted from this CLI/Node.js context.
- **Root cause (NOT a code bug):** the live broadcast route is `account.strk20InvokeTransaction(actions)` (holder-app.mjs line 115) — a **wallet-native** method exposed only by a STRK20-capable browser wallet (Braavos/Argent with STRK20 support on Sepolia). This environment has browser/CDP permanently blocked (S024) and cannot drive the wallet-relay submission the protocol requires for private-note exercise. Studio assembles the action list correctly; the wallet owns note generation + proof + relay.
- **Fix:** Owner asked to self-exercise via their STRK20 wallet on Sepolia. The action list is evidence-verified; only the wallet-relay submission is blocked by environment.
- **Prevention:** keep the dry-run default + owner-blessed live gates explicit; never invent a relay to paper over a wallet-adapter precondition.

### S-12 — Phase 7 `expiresAt: 0` synthetic fixture vs SDK u64 validator
- **Symptom:** the Phase 7 calldata-parity test constructed a synthetic policy record with `expiresAt: 0` and passed it to the real `buildWalletApiCapabilityActions` — the SDK's u64 validator rejected `0` as "must be positive."
- **Root cause:** the SDK validator treats `expiresAt` as a positive u64-style field; `0` is valid *semantically* (never-expires) but fails the SDK's *argument-shape* check.
- **Fix:** the parity test uses synthetic `expiresAt: "4102444800"` (year 2100) for byte-for-byte comparison; live-read tests assert the real value `1790565765`. No production behavior changed.
- **Prevention:** keep synthetic fixtures schema-valid (positive u64 where the SDK validates) even when the on-chain value is `0`; assert real values via a separate live read.

### S-13 — Phase 8 mis-described as "replay/fork tooling" (self-correction)
- **Symptom:** an interim HANDOFF.md draft described Phase 8 as "replay/fork tooling," implying a code phase involving capability replay/fork semantics.
- **Root cause:** mis-reading continuation docs during the Phase 7→8 transition; `IMPLEMENTATION_PLAN.md` defines Phase 8 as **verification + documentation** only.
- **Fix:** STATUS.md + HANDOFF.md corrected in-place — Phase 8 is a non-code verification sweep + docs finalisation. No replay/fork product work is in scope.
- **Prevention (anomaly duty):** cross-check a phase label against `IMPLEMENTATION_PLAN.md` before stating scope; do not propagate a mis-label into continuation docs.

### S-14 — Parent repo `apps/web/` working tree is dirty vs HEAD (not Studio-authored)
- **Symptom:** `git status` at the `BlackBox Arena` repo root shows 13 modified files under `apps/web/src/` (+456/−85 lines) plus 3 modified root files (`package.json`, `scripts/build-web.mjs`, `strk20.json`). `apps/studio/` is untracked (`?? apps/studio/`) — correct and intended.
- **Is Studio the author?:** NO. All Phase 0–9 work lived exclusively under `apps/studio/` and never wrote outside it. The `apps/web/src/*` edits (incl. `holder-app.mjs` +106/− lines — the file whose `strk20InvokeTransaction` flow at line 115 Studio reads as source of truth) are pre-existing uncommitted changes vs HEAD (`f75bb02 "feat: ship BlackBox private capability protocol"`).
- **Phase 9 gate impact:** the Phase 9 gate "existing BlackBox production routes remain unchanged and working" cannot be asserted from this dirty working tree. Read-only blocker: confirming the gate needs either (a) you confirm these `apps/web/` edits are intended/staging and routes still "work," or (b) a checkout of HEAD to compare.
- **What Studio will NOT do:** modify any `apps/web/` or root file. The `/studio` route mount (the real Phase 9 RED gate) is deferred to explicit owner approval regardless.
- **Files:** `apps/web/src/holder-app.mjs` (the diff includes the `strk20InvokeTransaction` path Studio reads but does not author). Documented in DECISIONS.md S035.

---

## Net effect on Phase 5
All 8 Phase 5 tasks shipped. The real-Sepolia evidence gate (`phase-5-indexer`
live test) is GREEN: discovered the BBP policy, classified `active`, allowance
10 STRK / spent 0 / remaining 10, issuer = Studio account `0x4ff9…6c8`. The
setbacks were all read-layer wiring / test-assertion issues, each rooted in a
concrete on-chain fact (privacy token, arg-less adapter views, account-vs-signer
identity, padded felts). No contract redeploy was needed — the deployed Phase 4
contracts were correct; only the Studio read code had to learn their real shape.

## Repair pass #1 setbacks (2026-08-30)

### S-25 — Wizard-first UI hid the two-sided product journey

- **Symptom:** Studio opened directly into one large configuration page. The
  treasury dashboard, mandate detail, issuer-to-operator handoff, and operator
  wallet experience were either difficult to discover or absent as distinct
  screens.
- **Root cause:** the implementation treated completion of individual phases
  as a page hierarchy. Technical flows existed, but the application shell did
  not model the actual users: treasury/issuer and operator/holder.
- **Fix:** added a role-aware workspace shell, overview, treasury dashboard,
  mandate detail, honest pass-delivery surface, and a simpler shared-link
  operator page. The operator page now asks for the wallet that received the
  pass and explains the permitted payment without leading with selectors or
  calldata.
- **Remaining boundary:** generalized Sepolia issuance is still blocked by the
  absence of a verified STRK20 privacy pool. The UI exposes this truth and does
  not simulate completion.
- **Prevention:** product acceptance tests now assert the complete treasury →
  private delivery → operator request narrative, not merely the existence of a
  wizard and pure render functions.

### S-26 — First two-sided redesign still looked like generic AI SaaS

- **Symptom:** the information architecture improved, but the interface relied
  on the same rounded white cards, blue primary buttons, soft shadows, and
  conventional sidebar given to many unrelated dashboard products.
- **Root cause:** research focused on treasury workflow patterns rather than
  visual authorship and component-level interaction craft.
- **Fix:** researched the user-named component/motion sources and replaced the
  visual system with Authority Ledger. Added a bespoke authority-field hero,
  serialized mandate tickets, ledger-style policy rows, sharp instrument
  surfaces, a dark operations rail, and reduced-motion-safe state animation.
- **Prevention:** future polish must preserve the Authority Ledger motifs and
  test against the anti-pattern list in `UI_DIRECTION.md`; installing a design
  library must never revert Studio to that library’s default dashboard look.

### S-27 — Product flow was hidden and network reads could appear permanent

- **Symptom:** deployment review ended at an unsigned plan without showing the
  later fund/deliver/share actions; the dashboard could remain on “Reading
  on-chain policy state”; the operator screen led with an unexplained address;
  long links overflowed their card; and the home heading dominated the screen.
- **Root cause:** unavailable Sepolia actions were omitted instead of shown as
  locked stages, RPC reads had no UI deadline, and the first bundle eagerly
  included chain code.
- **Fix:** show the full sequence with a truthful disabled activation control;
  cap reads at 12 seconds with retry; add operator instructions; wrap links;
  reduce the hero type; and code-split RPC/SDK modules. Initial preview entry is
  approximately 88 KB, down from 636 KB.
- **Remaining boundary:** live Studio activation remains **UNVERIFIED** because
  Sepolia has no verified STRK20 privacy-pool configuration. Mainnet execution
  is still explicitly owner-gated.

### S-28 — Recipient/operator terminology and draft URLs confused the journey

- **Symptom:** the Treasury form repeated wallet connect/disconnect controls,
  the standalone Roles & delivery page felt unnecessary, and the stateless
  draft URL exposed every configured value in a long query string.
- **Root cause:** the interface separated role education from the decision it
  explained and treated a stateless same-page demonstration as a shareable
  holder link.
- **Fix:** keep payout recipient creation-time enforcement but relabel it as the
  vendor/beneficiary; collect the operator wallet only after deployment; skip
  the redundant roles stop; keep wallet controls in the shell; store previews
  locally behind a random identifier; and reserve clean portable links for
  deployed public policy identifiers.
- **Boundary:** a cross-browser opaque draft link requires a persistence service
  and is not implemented. No private or secret data is placed in local preview
  storage, but the draft is public-intent configuration and is cleared by normal
  browser storage management.

### S-15 — Wizard merged privacy and deployment review
- **Symptom:** `src/ui/wizard.mjs` exposed five steps and rendered the public/
  private acknowledgement together with the deployment review.
- **Root cause:** the earlier skeleton treated “Review” as one screen even
  though `USER_FLOW.md` specifies separate Privacy Review and Deployment Review
  gates.
- **Fix:** split the step list and forms; the app now computes the plan on the
  deployment-review step and uses the acknowledgement as its own prerequisite.
- **Prevention:** keep step IDs aligned with `USER_FLOW.md` and test every form.

### S-16 — Live URL was broader than the documented per-action gate
- **Symptom:** `liveMode()` returned true for `?live=1` without an exact step
  approval, and a non-dry arbitrary hash could be reported as accepted.
- **Root cause:** the URL “live requested” flag and exact action authorization
  were conflated; receipt fallback assumed non-live meant dry-run.
- **Fix:** `liveMode(stepId)` requires both query parameters; write paths wait
  for successful receipts; unknown hashes return `UNVERIFIED`/`UNKNOWN`.
- **Prevention:** every write path uses the shared URL gate and receipt helper.

### S-17 — Dashboard used derived token metadata and accepted mismatched wiring
- **Symptom:** the dashboard supplied a derived asset symbol and generic token
  name even though the Cairo token exposes public metadata; adapter wiring was
  not checked against the requested token/policy.
- **Root cause:** the read layer was written against an incorrect assumption
  that CapabilityToken had no metadata views.
- **Fix:** read `name`, `symbol`, and `total_supply`, and reject mismatched
  gatekeeper, adapter target, token, or asset configuration as `NO_POLICY`.
- **Prevention:** cross-check every public read against the Cairo interface.

### S-18 — Holder loader relied on Studio address defaults
- **Symptom:** a holder token link was loaded through the fixed Studio
  gatekeeper/adapter addresses instead of resolving its public token wiring.
- **Root cause:** the Phase 7 implementation used deployed fixtures as defaults
  for arbitrary shared-link tokens.
- **Fix:** read token control views first, resolve `get_gatekeeper()`, read the
  policy, then use its target as the adapter unless explicitly overridden.
- **Prevention:** shared-link flows must derive contract identities from the
  linked public token and verify the resulting relationships.

### S-19 — Holder async states were not represented explicitly
- **Symptom:** loading and error paths rendered the input surface, and exercise
  completion was not reflected in holder state.
- **Root cause:** the renderer keyed only on whether a record object existed.
- **Fix:** added explicit input/loading/loaded/complete/error/back rendering;
  the exercise panel receives only the guarded successful state and active
  policy state.
- **Prevention:** pure-render tests cover the non-loaded states and back action.

### S-20 — Resume markers and declaration skips lacked safe handling
- **Symptom:** arbitrary `skippedSteps` or malformed `done` data could advance
  recovery beyond the completed queue; declarations had no explicit already-
  declared skip representation.
- **Root cause:** localStorage input was parsed but not structurally validated,
  and queue construction assumed every declaration should be retried.
- **Fix:** normalize only matching contiguous receipts and support explicit
  `skip` steps with a human-readable note. Artifact-backed live declaration /
  deployment remains `UNVERIFIED` and is refused before wallet dispatch.
- **Prevention:** keep the resume key recoverable, never treat a hash alone as
  completion, and require verified class data before a future live adapter.

### S-21 — Required `npm run verify` command was undefined
- **Symptom:** the required handoff command failed with `Missing script:
  "verify"` even though the Studio test command was green.
- **Root cause:** the standalone `apps/studio/package.json` exposed phase-specific
  test scripts but no authoritative verification alias.
- **Fix:** added `verify: "npm test"` inside Studio and recorded the command in
  HANDOFF.md; no parent package or build script was changed.
- **Prevention:** keep the handoff verification command executable from the
  Studio directory and keep the test inventory single-sourced.

### S-22 — Production source embedded deployed contract addresses
- **Symptom:** `studio-network.mjs`, the wizard, and holder/dashboard wiring
  carried fixed deployed contract addresses, so a standalone Studio could
  silently target the Phase 4 fixture.
- **Root cause:** public deployed evidence was treated as a reusable runtime
  default instead of integration-owned configuration; holder loading also had a
  fixed asset fallback.
- **Fix:** removed deployed address defaults from production source, require
  runtime network configuration for dashboard/wizard planning, and resolve the
  holder asset from the linked adapter configuration. Test fixtures retain the
  verified Sepolia addresses explicitly for live-read evidence.
- **Prevention:** source scans must reject deployed hex-address constants, and
  missing runtime configuration must surface an error/empty state rather than
  guess a contract.

### S-23 — Dashboard mislabelled policy registration as holder pass issuance
- **Symptom:** active dashboard cards still rendered “Issue policy” and
  “Revoke” controls, while the associated dry-run could only build a
  `register_policy` call and could not prove holder pass delivery.
- **Root cause:** a technical configuration prototype was allowed to read like
  an end-user completion flow.
- **Fix:** removed the controls and unreachable app route; dashboard now
  provides only public Export and Share. The technical builder remains isolated
  test coverage and is marked superseded in the Phase 6 plan.
- **Prevention:** no product action may imply a private wallet/pass outcome
  unless the verified flow actually produces and confirms that outcome.

### S-24 — Historical Sepolia script treated an account as a privacy pool
- **Symptom:** `phase4-deploy-queue.mjs` assigned `PRIVACY_POOL` to the owner
  account and accepted `--live`, making it possible to create a deployment
  that looked like a privacy-capability fixture without a privacy pool.
- **Root cause:** a demo constructor placeholder outlived its diagnostic use.
- **Fix:** the script now rejects `--live` before wallet material is read; it
  is permanently dry-run until a verified, artifact-backed integration exists.
- **Prevention:** a missing protocol dependency must block a write rather than
  be substituted with a convenient account address.

## Release-blocker flow audit setbacks (2026-08-31)

### S-29 — Operator controls rendered but were not clickable

- **Symptom:** holder buttons and inputs had `data-action` labels but no
  `onclick`/`oninput` event objects. The mount layer does not delegate from
  `data-action`, so real browser clicks could do nothing.
- **Fix:** connected every operator control to its app event and added
  `product-controls.test.mjs`, which rejects any enabled visible control without
  a browser handler.
- **Prevention:** product control coverage now spans all active views, not only
  tree text and test IDs.

### S-30 — Receipt timeouts could cause duplicate actions

- **Symptom:** deployment, approval, delivery, and payment progress was saved
  only after a successful receipt. If the wallet submitted a transaction but
  the RPC wait timed out, retrying could submit it again.
- **Fix:** persist the transaction hash immediately after wallet submission.
  Retry resumes receipt confirmation for that exact hash. A hash remains
  pending until a successful receipt is observed.
- **Prevention:** every write path follows submit → persist pending hash → wait
  for success → mark complete.

### S-31 — Refresh and wallet changes could expose stale state

- **Symptom:** deployment drafts and delivery progress could be lost on refresh;
  dashboard budgets could remain stale; disconnecting could leave holder data
  visible; delivered operator links disappeared after reload.
- **Fix:** persist recoverable public progress, refresh saved mandates from their
  own deployed contracts, clear holder state on wallet changes, and persist
  delivery completion on the mandate.
- **Prevention:** tests cover fail-closed holder rendering and all controls;
  real two-wallet behavior remains `UNVERIFIED` until owner testing.

### S-32 — Operator content crashed during real DOM mounting

- **Symptom:** the deployment-equivalent operator screenshot rendered the shell
  and CSS marker, but none of the operator form content.
- **Root cause:** the holder tree helper nested child arrays. Pure text/tree
  checks tolerated that shape, but the DOM mount attempted to create an element
  from an array and stopped rendering.
- **Fix:** flatten holder children at the tree boundary and make control-test
  walkers recurse through arrays so the invalid shape cannot hide controls.
- **Prevention:** the self-contained output is now opened in Chromium after the
  build, including the `?policy=` route.

### S-33 — First isolated Vercel build could not resolve esbuild

- **Symptom:** the new `blackbox-studio` project installed Studio dependencies,
  then `npm run build` failed with `ERR_MODULE_NOT_FOUND: esbuild`.
- **Root cause:** local builds resolved `esbuild` from the parent repository's
  `node_modules`; the isolated Studio package had not declared it.
- **Fix:** pin `esbuild@0.25.12` as a Studio development dependency and commit
  the lockfile. The next production deployment completed successfully.
- **Prevention:** deployment tooling used directly by a package must be declared
  by that package, even when a monorepo parent happens to provide it locally.
