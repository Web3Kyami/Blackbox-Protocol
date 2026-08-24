# Handoff

This is the canonical continuation guide for another IDE or coding agent. The project is already stored on the Windows host at:

`C:\Users\USER\Documents\ChatGPT\BlackBox Arena`

Open that folder directly in the new IDE. For WSL-native extensions, open the same folder through Ubuntu at:

`/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena`

## Start here

1. Read `AGENTS.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/NETWORKS.md`, `docs/ARCHITECTURE.md`, and `docs/PRIVACY_MODEL.md`.
2. Do not reinstall Rust or Node. Use the existing `Ubuntu` distro and `kyami` user, not `Ubuntu-22.04`/`root`.
3. Run the environment check and repository verification below.

```powershell
wsl -d Ubuntu -u kyami -- bash -lic 'whoami; echo $HOME; rustc --version; cargo --version; node --version; npm --version'
wsl -d Ubuntu -u kyami --cd "/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena" -- bash -lc 'export PATH=/home/kyami/.nvm/versions/node/v24.19.0/bin:/home/kyami/.cargo/bin:/home/kyami/.local/bin:/home/kyami/.asdf/shims:/usr/bin:/bin; npm run verify'
```

Expected tool output: `kyami`, `/home/kyami`, Rust/Cargo 1.98.0, Node 24.19.0, npm 11.17.0. Expected project result: 20/20 Node tests, web build, type checks, formatting, and secret scan pass.

## Repository map

- `packages/core/src/arena.mjs`: executable local rules, validation, evidence, scoring, authority, and settlement cap.
- `fixtures/strategies/case-study.mjs`: Falcon/Tortoise/Pulse actions and commitments; no winner constant.
- `packages/core/test` and `tests`: 20 tests.
- `apps/web/src`: dependency-free responsive demo.
- `scripts/build-web.mjs`: runs fixture and emits `dist/web/case-study.json`.
- `contracts/src/arena.cairo`: compiled and unit-tested onchain mirror.
- `contracts/src/arena_adapter.cairo`: compiled official-pattern STRK20 adapter; custom privacy invocation remains unverified.
- `_research`: ignored shallow official checkouts; disposable and not part of the project.

## Verified checkpoints

- Deterministic JavaScript specification: 20/20 tests pass.
- Blackbox Cairo contracts: compile with Scarb 2.17.0; 5/5 Foundry 0.59.0 tests pass.
- Official privacy SDK: TypeScript build passes.
- Official privacy discovery service: Rust release build passes.
- Official unchanged privacy smoke test: 1/1 passes on Devnet 0.8.0-rc.3, including deposit, shielded transfer, and discovery.
- No Sepolia or mainnet deployment has occurred.

## Exact next implementation sequence

### 1. Resolve cyclic deployment safely

The Arena constructor currently needs the adapter address while the adapter constructor needs the Arena address. Implement a sponsor-only, one-time `set_action_adapter` operation that is permitted only before registration/start, starts from the zero address, rejects zero/replacement values, emits an event, and becomes permanently locked. Add Cairo tests for caller authorization, timing, zero value, and second assignment. Update `docs/DECISIONS.md` and `docs/STATUS.md`.

Acceptance: Arena and adapter can be deployed sequentially without precomputed addresses, and the adapter cannot be changed after initialization.

### 2. Add a Blackbox Devnet E2E test

Reuse the pinned upstream privacy checkout and its E2E harness. Do not test the adapter with a direct public call. The route must be:

`shielded note -> privacy pool privacy_invoke -> ArenaAdapter -> Arena`

Deploy a local test token, privacy pool dependencies, Arena, and ArenaAdapter. Set the adapter once, register strategies, start the Arena, and submit deterministic receipt IDs.

Acceptance:

- A valid Tortoise action changes Arena state and returns the expected change note.
- Falcon's oversized 700/1000 allocation is rejected and does not change portfolio value.
- Duplicate receipt replay is rejected.
- Pool caller authentication, input token, input amount, and returned `OpenNoteDeposit` are asserted.
- The test records no private key, viewing key, prompt, or strategy implementation in fixtures/logs.

### 3. Reconcile the Cairo mirror with the JavaScript specification

Compare every rule, integer-basis-point calculation, truncation behavior, evidence field, score, eligibility condition, tie-break, authority check, and settlement cap. Add missing Cairo tests until the case-study result is identical: Tortoise wins with 400 bps; Falcon is second at -100 bps; Pulse is ineligible.

Acceptance: no winner constant exists; ranking is derived by the contract-owned or contract-verified scorer.

### 4. Connect the web app to local chain evidence

Replace fixture-only reads behind a clear data-source boundary while retaining the deterministic fixture as demo/fallback. Indexers and the UI remain views, never scoring authorities. Display network, contract addresses, block/transaction references, accepted/rejected receipts, and an explicit privacy disclosure that shielding deposits expose address, token, and amount.

Acceptance: the UI labels simulated versus Devnet data unmistakably and exposes no secret material.

### 5. Final verification and documentation

Run:

```powershell
wsl -d Ubuntu -u kyami --cd "/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena" -- bash -lc 'export PATH=/home/kyami/.nvm/versions/node/v24.19.0/bin:/home/kyami/.cargo/bin:/home/kyami/.local/bin:/home/kyami/.asdf/shims:/usr/bin:/bin; npm run verify'
wsl -d Ubuntu -u kyami --cd "/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/contracts" -- bash -lc 'export PATH=/home/kyami/.cargo/bin:/home/kyami/.local/bin:/home/kyami/.asdf/shims:/usr/bin:/bin; scarb build; snforge test'
```

Also rerun the custom Devnet E2E test. Update `docs/STATUS.md`, `docs/TESTING.md`, `docs/NETWORKS.md`, `docs/DECISIONS.md`, and `strk20.json` only with real evidence.

## Pinned local privacy environment

- WSL distro/user: `Ubuntu` / `kyami`
- Scarb: 2.17.0
- Starknet Foundry: 0.59.0
- Starknet Devnet: 0.8.0-rc.3 at `/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin/starknet-devnet`
- Privacy checkout: `_research/starknet-privacy`, tag `PRIVACY-0.14.3-RC.2`
- `_research` is ignored and disposable. It is useful for local continuation but should not be committed as Blackbox source.
- Sepolia RPC: Alchemy via `.env.local` `ALCHEMY_API_KEY` (D015). Free public endpoints are catalogued broken in `docs/NETWORKS.md`.
- Sepolia burner deployer: credentials in `.env.local`; address/tx history in `docs/NETWORKS.md`. Burner — discard after sprint.

When running upstream E2E, put the pinned Devnet directory before asdf shims in `PATH`. Do not silently use Devnet 0.9.0.

## Phase 7 continuation (2026-08-23 handoff)

Sepolia rehearsal interrupted mid-deployment. Exact position, measured costs, gotchas, and next steps live in `docs/STATUS.md` ("Phase 7 exact position"), `PHASE4-PLAN.md` (Phase 7 section), and D014/D015 in `docs/DECISIONS.md`. Helper scripts for every Sepolia operation are in `scripts/sepolia-*.mjs` + gate runners `scripts/run-{fast,devnet}-gate.sh`. Read those first; do not re-derive the RPC landscape or starknet.js v10 quirks (catalogued in NETWORKS.md).

## Privacy integration warning

Recheck the current Starknet Privacy compatibility matrix before any nonlocal deployment. The unmodified base E2E flow already passes locally. The custom adapter must be called via pool `privacy_invoke`; a direct public adapter call is not evidence.

## Owner-dependent later actions

Sepolia will eventually require a disposable account, RPC credential, and faucet funding. Ask only after Devnet passes and provide the exact address, network, token amount, and reason. Mainnet stays manual and requires explicit approval.
