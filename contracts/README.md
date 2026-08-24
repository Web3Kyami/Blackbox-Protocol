# Cairo contracts

This is a minimal, single-Arena feasibility contract and a custom STRK20 adapter patterned on the official starter kit's `privacy_invoke` echo helper and the official Vesu/Ekubo anonymizers.

Status: **COMPILED AND UNIT TESTED / NOT DEPLOYED**. `scarb build` passes with Scarb 2.17.0 and 5/5 Starknet Foundry 0.59.0 tests pass in WSL. The STRK20 invocation route remains `UNVERIFIED`; do not deploy beyond local Devnet until the official base-flow reproduction passes.

The adapter authenticates the configured privacy pool, records the action through the Arena, then approves and returns all input tokens as an `OpenNoteDeposit`. That return/change behavior is intentional for the feasibility spike; it is not a prize settlement implementation.
