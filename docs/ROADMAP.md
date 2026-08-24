# Roadmap

## Completed

- Stage 0 product, architecture, privacy, network, testing, and decision basis.
- Tested deterministic JavaScript Arena and case study.
- Responsive public demo generated from the real fixture engine.
- Minimal Cairo Arena and authenticated adapter source draft.

## Completed — Stage 1 contract gate

Scarb 2.17.0 and Starknet Foundry 0.59.0 are installed in WSL. The Cairo contracts compile; Foundry coverage has since grown to 24/24 tests including the full case-study outcome (Tortoise +400 winner, Falcon −100, Pulse ineligible), replay protection, tie-breaks, multi-asset allowlists, adapter lock, rules commitment, and sponsor price feed. See `docs/STATUS.md`.

## Completed — Stage 2 Devnet feasibility

Full local lifecycle verified on pinned Devnet 0.8.0-rc.3: sequential deploy with one-time adapter lock, upstream privacy smoke unchanged, custom `privacy_invoke` → `ArenaAdapter` → `Arena` E2E, registration, shielded actions (valid, oversized, duplicate replay), close, deterministic winner, capped settlement, and web lifecycle controls. Feasibility gate GREEN; see `docs/STATUS.md`.

## Current — Stages 4–7 pre-mainnet product completion

Owner decision 2026-08-23: no mainnet until the product is finished; no real money spent on debugging. The active plan lives in [`PHASE4-PLAN.md`](../PHASE4-PLAN.md):

- Phase 4 — contract completeness: parity breadth, operator binding, settlement token payout, honest documentation of self-reported after-values (D012).
- Phase 5 — wallet integration and self-service strategy participation.
- Phase 6 — dashboard evidence completion (tx links, network labels, evidence export).
- Phase 7 — Sepolia dress rehearsal (owner-dependent, stop-and-ask).

## Later stages

- **Stage 8 — mainnet readiness only.** Verify current pool/services/tags, simulate exact transactions, estimate STRK, document leakage and rollback, then stop at `MAINNET APPROVAL REQUIRED`. Explicit owner approval is a precondition for any mainnet signing or deployment.
- Post-sprint hardening backlog (not scheduled): sponsor-signed valuations or Pragma oracle replacing D012's accepted trust assumption; Green-path private payout through the pool as an alternative to escrowed prize tokens.
