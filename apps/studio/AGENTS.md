# BlackBox Studio working rules

Read these files, in order, before taking any action:

1. `README.md`
2. `docs/GOAL.md`
3. `docs/USER_FLOW.md`
4. `docs/UI_DIRECTION.md`
5. `docs/REUSE_MAP.md`
6. `docs/PRODUCT_REQUIREMENTS.md`
7. `docs/IMPLEMENTATION_PLAN.md`
8. `docs/DECISIONS.md`
9. `docs/STATUS.md`
10. `docs/HANDOFF.md`
11. `docs/SETBACKS.md`  ← honest error/setback log (read before claiming "done")

## Goal

Build BlackBox Studio into a user-first, self-service application where a
Starknet protocol can configure, deploy, issue, monitor, and share a Private
Treasury Mandate without manually assembling BlackBox contracts.

The required user journey is:

> Connect → configure → review → deploy → fund → issue → monitor → share → exercise.

## Isolation boundary

- All Studio implementation must remain inside `apps/studio/`.
- Do not edit, delete, rename, reformat, or relocate anything outside
  `apps/studio/` without explicit owner permission.
- Existing BlackBox files may be read and code may be copied into Studio.
- Studio must not import source files by relative paths that make it depend on
  uncommitted edits to the existing application.
- Do not change existing Mainnet contracts, addresses, policies, website pages,
  build scripts, Vercel configuration, README, or root documentation.
- Future integration at `/studio` is a separate owner-approved stage.

## Git boundary

- Studio work belongs on the dedicated branch `codex/blackbox-studio`.
- Never commit or push Studio work directly to `main`, `master`, or the branch
  carrying the existing BlackBox product.
- Before implementation, check the current branch. If the dedicated branch does
  not exist, create it without rewriting or discarding existing work.
- Creating the Studio branch does not authorize a push.
- Do not push any branch, open a pull request, merge, rebase, or modify a remote
  without explicit owner approval.
- If the environment cannot create or isolate branches safely, continue without
  committing and record the limitation in `docs/STATUS.md` and `docs/HANDOFF.md`.

## Product rules

- Call the product **BlackBox Studio**. Do not attach internal release-stage or
  maturity labels to its user-facing name unless the owner explicitly requests it.
- Prioritize the protocol-team user flow over developer documentation.
- The only functional mandate at launch is **Private Treasury Mandate**.
- Future mandate types may be shown only as clearly disabled `Coming next`
  options. Never simulate them.
- Never show invented organizations, policies, private balances, transaction
  history, contract addresses, receipts, or successful deployments as real.
- A draft or deployment plan must be labelled as such until verified onchain.
- No Mainnet signing, broadcast, deployment, allowance, or spending without
  explicit owner approval for that exact action.

## Existing protocol reuse is mandatory

- Studio is a product layer for the existing BlackBox Protocol. It is not a new
  protocol implementation.
- Read and follow `docs/REUSE_MAP.md` before proposing architecture or writing code.
- Do not create replacement Gatekeeper, CapabilityToken, TreasurySpendAdapter,
  privacy-pool integration, policy SDK, delivery-marker logic, or wallet flow.
- Reuse the existing declared classes, deployed evidence, contract interfaces,
  SDK builders, and verified wallet-native STRK20 route.
- If a required capability appears absent, document the gap before writing new
  protocol code. New or modified Cairo requires explicit owner approval.
- UI composition, dynamic configuration, transaction orchestration, public-state
  indexing, and recovery are Studio work. Reimplementing BlackBox enforcement is not.

## Privacy and security rules

- Never describe shielding or deposit as private. Depositor, token, and amount
  are public.
- Keep private keys, seed phrases, viewing keys, note plaintext, wallet logs,
  auth tokens, and prover credentials out of files, fixtures, UI, and logs.
- Private-note ownership belongs to the wallet; Studio must not invent a
  private capability inventory.
- Transaction-sender separation depends on the wallet relay path.
- Every configurable field must map to a real contract-enforced constraint.
- Arbitrary calldata is out of scope for the Treasury Mandate.

## Documentation discipline

After every implementation stage:

1. Update `docs/STATUS.md` with completed work and verification evidence.
2. Update `docs/DECISIONS.md` for any product or architecture decision.
3. Update `docs/HANDOFF.md` so another model can continue without chat history.
4. Mark untested network, wallet, privacy, and deployment claims `UNVERIFIED`.
5. Record exact blockers and the next smallest useful action.

Do not claim a stage complete merely because its interface exists. Completion
requires the acceptance conditions in `docs/IMPLEMENTATION_PLAN.md`.
