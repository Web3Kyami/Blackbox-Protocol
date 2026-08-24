# Blackbox Arena engineering guide

Read `docs/STATUS.md`, `docs/DECISIONS.md`, and `docs/NETWORKS.md` before changing network or privacy code.

## Non-negotiable rules

- Never hard-code a winner. Rankings must come from the deterministic scorer.
- Never describe shielding as private; its depositing address, token, and amount are public.
- Mark untested privacy and network claims `UNVERIFIED`.
- Keep prompts, strategies, viewing keys, and credentials out of public state and fixtures.
- Use integer basis points; division truncates toward zero.
- Do not deploy or sign on mainnet without explicit owner approval.
- Update `docs/STATUS.md` after each stage.
- Run `npm run verify` before handoff.

## Boundaries

Critical Arena state and final scoring must be contract-owned or contract-verified. Indexers and the web app are views only. The local JavaScript engine is an executable specification until its Cairo mirror passes contract tests.

