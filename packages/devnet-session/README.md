# @blackbox-arena/devnet-session

Blackbox Arena Devnet Session Service, Sequential Deployment Layer, and On-Chain Verification Suite.

## Overview

This package contains the tracked integration layer that connects Blackbox Arena's Cairo contracts (`Arena`, `ArenaAdapter`) with the Starknet Privacy SDK and local Devnet 0.8.0-rc.3.

It provides:
- **Sequential Deployment Supervisor (`blackbox-session.ts`)**: Deploys `Arena`, `ArenaAdapter`, and engages the immutable `set_action_adapter` lock.
- **Sanitized Localhost Service (`SessionServiceServer`)**: Serves sanitized session state and evidence at `http://127.0.0.1:4174` with strict Origin allowlisting and zero secret leaks.
- **Stage A Automated Suite (`stage-a-session.test.ts`)**: Asserts sequential deployment, adapter locking, health checks, static ABIs, and secret exclusion.
- **Stage B Automated Suite (`stage-b-dashboard.test.ts`)**: Asserts contract-verified state reads, empty session evidence on fresh boot, and Origin security.
- **E2E Privacy Verification (`blackbox-arena.test.ts`)**: End-to-end shielded note deposit, privacy SDK proof generation, `privacy_invoke`, Tortoise on-chain score derivation, change note discovery, Falcon rule rejection, and replay protection.

## Pinned Environment Requirements

- **Starknet Devnet**: `0.8.0-rc.3`
- **Scarb**: `2.17.0` (Cairo 2.17.0 / Sierra 1.9.3)
- **Node.js**: `24.19.0`
- **Starknet Foundry (`snforge`)**: `0.59.0`
- **OS / Distro**: Windows 11 with WSL `Ubuntu` (user: `kyami`)

## Running Verification

From the repository root:
```bash
# Run the complete Devnet verification suite (Stage A, Stage B, and Blackbox E2E):
npm run verify:devnet
```

## Running the Live Devnet Session Service

From Windows PowerShell:
```powershell
npm run devnet:session
```
This spawns the background Devnet node, deploys contracts, locks the adapter, and opens `http://127.0.0.1:4174` for the dashboard (`http://127.0.0.1:4173`).
