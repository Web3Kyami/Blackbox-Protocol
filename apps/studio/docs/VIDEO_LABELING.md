# Studio video / demo labeling spec

> Single source of truth for what the Studio demo video may claim as
> "verified" vs "unverified." Derives from `docs/UI_DIRECTION.md` (Content
> rules) + the product invariants (`S006 No simulated success`, `S009` wallet
> owns private state). No code; demo-only reference.

## Verified states (may be shown in a demo video)

These states are either **onchain-verified** (asserted against Sepolia RPC
during Phase 5/7 live tests) or **test-verified** (covered by the 95/95 suite).

| State label (UI text) | What it means | Evidence source |
|---|---|---|
| `Verified onchain` | A transaction receipt was fetched and the expected public state change is confirmed on Sepolia. | Phase 5 indexer live test (policy discovery, allowance 10 STRK, `total_spent=0`); Phase 4 deploy receipts (9 txs accepted L2). |
| `Transaction submitted` | A tx hash was obtained; receipt NOT yet polled/verified. | Phase 4 `account.execute` returns a hash; receipt not yet re-queried. |
| `Awaiting wallet confirmation` | A wallet pop-up was triggered and is pending user sign. | Phase 2/4 wallet-adapter stub (`account.execute` not yet called). |
| `Active` (policy) | Onchain `state = active` from `get_policy`, with no expiry or `now <= expiresAt`. | Phase 7 live read: BBP policy `state=active`, `expiresAt=1790565765`. |
| `Expired` | Onchain `state != active` and `expiresAt <= now`. | Phase 7 `classifyPolicy` unit test (excluded from live). |
| `Revoked` | Onchain `active === false` (contract flag, not just expiry). | S030 `classifyPolicy` unit test. |
| `Onchain` (activity source) | The event/state came from RPC, not a local draft. | Phase 5 indexer `record.source = "Onchain"`. |
| `Local draft` (activity source) | The row is a browser-local draft; no receipt. | Phase 5 dashboard smoke (draft vs onchain split tested). |

## Unverified states (must be labelled as such in a demo video)

If the video shows any of these, it MUST carry an on-screen `||unverified||`
badge and a voiceover label:

| State (do NOT show as success) | Why it is unverified | What is needed to verify |
|---|---|---|
| Holder exercising the real `privacy_invoke` (live `strk20InvokeTransaction` broadcast) | Blocked: no STRK20 browser wallet in this env (S024). Dry-run calldata is proven byte-identical to the SDK shape, but NO real note + ZK proof + relayer submission exists. | Owner runs the holder flow themselves through a STRK20-capable wallet on Sepolia. |
| Wallet-connect pop-up resolving to a real signed session | Cannot be driven headlessly (browser blocked, S024). | Owner connects Braavos/ArgentX on Sepolia live. |
| Post-deployment `/studio` route integrated into the live BlackBox site | Not built; integration is RED-owner-gated (Phase 9). | Owner approves `/studio` mount into `apps/web/`. |

## Content rules (from UI_DIRECTION.md — enforced verbatim)

Prefer (may appear in UI / demo):
- `Verified onchain`, `Transaction submitted`, `Awaiting wallet confirmation`,
  `No pass available`, `Pay up to 0.01 STRK`.

Avoid (never in UI primary flow, never in demo as success):
- `Transaction successful` before receipt verification,
- `Deploy magic`, `Simulate`, `Anonymous payment`, `Private deposit`,
- `Exercise capability` as the main action,
- explaining `Gatekeeper`/`selector`/`felt`/`calldata` in the primary flow.

## Rule for any demo video frame

> A frame may claim "verified" only if the on-screen state is one from the
> **Verified states** table above. Any state from the **Unverified** table must
> be overlaid `UNVERIFIED — owner self-exercise / live wallet pending (S024)`.

## Source files
- `docs/UI_DIRECTION.md` (Content rules + Deployment progress + Activity source labels)
- `docs/DECISIONS.md` (S006, S009, S024, S030–S034)
- `docs/PHASE9_PLAN.md`
