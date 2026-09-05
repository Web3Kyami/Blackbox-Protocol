# Network configuration

BlackBox Studio currently targets Starknet Mainnet.

| Item | Value |
|---|---|
| Chain ID | `SN_MAIN` |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Public RPC default | `https://rpc.starknet.lava.build` |

Run the read-only network check with:

```sh
npm run verify:mainnet-readiness
```

Set `BLACKBOX_MAINNET_RPC` to use another Mainnet RPC. The command verifies the
chain ID and expected class at the configured STRK20 pool. It never requests a
wallet signature.

## Wallet path

The holder and issuer flows use the Starknet Wallet API and the wallet-native
`strk20InvokeTransaction` method. The wallet handles private note discovery,
proof generation, and relay submission.

The STRK20 pool fee is separate from the treasury payment budget. Read the live
fee from the pool instead of copying an old value.

Local integration tests use Starknet Devnet and a prepared checkout of the
official Starknet Privacy repository. Local addresses are ephemeral.
