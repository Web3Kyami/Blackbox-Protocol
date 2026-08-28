# Submission preparation

## Three-minute demo script

1. **0:00–0:25 — problem:** protocol keepers and treasury operators need bounded
   authority, but a public operator wallet creates a permanent target and linkable profile.
2. **0:25–0:55 — policy:** show the public Gatekeeper policy: fixed target,
   selector, first-argument cap, expiry, and reusable versus one-shot mode.
3. **0:55–1:30 — capability:** show the zero-decimal bearer token entering the
   STRK20 pool, then the holder-side Wallet API action array. Explain that the
   deposit edge is public; the private note and holder-to-use link are the privacy boundary.
4. **1:30–2:10 — enforcement:** show the local E2E calling the Gatekeeper through
   the real pool. Reusable passes return a new note; one-shot passes burn; wrong
   target, amount, expiry, replay, and preloaded delivery all fail in Cairo tests.
5. **2:10–2:40 — sender check:** show a successful receipt where the public
   transaction sender differs from the holder. State clearly that direct holder
   submission leaks the holder and that browser/RPC metadata is outside the guarantee.
6. **2:40–3:00 — handoff:** show the SDK, MIT license, unsigned release bundle,
   `npm run verify`, `npm run verify:capability`, and the remaining owner-gated
   mainnet milestone.

## Required public artifacts

- Public repository and MIT license: repository initialized locally; remote not configured.
- Public demo URL: missing.
- Three-minute video URL: missing.
- Successful Mainnet STRK20 pool evidence: verified issuance transaction
  [`0x26a637…8e589`](https://voyager.online/tx/0x26a63750cb24beb38cc4eb8a976d04458c9015331b63be89a71c309a2b8e589),
  accepted at block `13992891`, plus verified holder exercise
  [`0x7978bc…d1386`](https://voyager.online/tx/0x7978bc0e9292a86c9e01411784dd6ec3db117e967a2ec08a2131844579d1386),
  accepted at block `13993785`. One further successful pool-touching
  transaction is needed for the sprint threshold.
- BlackBox contract involvement is verified in the holder-exercise receipt:
  configured pool → Gatekeeper → TreasurySpendAdapter paid the fixed `0.01 STRK`.

## Mainnet readiness report status

Local contract and RC.5 pool compatibility are verified. The first owner-gated
Mainnet issuance receipt is now verified; holder discovery and exercise still
require owner approval and independent receipt checks. Never populate a
transaction hash speculatively.
