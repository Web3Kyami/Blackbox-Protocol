// =============================================================================
// Studio network layer — read-only constants and RPC factory
// =============================================================================
//
// This module centralises the *read* side of Studio's chain access. It never
// signs, broadcasts, or mutates state. It exists so the dashboard, indexer,
// and holder modules share one Mainnet RPC and explorer configuration.
//
// It is deliberately free of secrets. The RPC key is a public endpoint
// constant (no signing), and no private key is ever imported here.
//
// Reads never need the connected wallet.
// =============================================================================

import { RpcProvider } from "starknet";
export {
  VOYAGER_BASE,
  readRuntimeNetworkConfig,
  explorerTx,
  explorerAddress,
  explorerToken,
} from "./public-config.mjs";

export const DEFAULT_MAINNET_RPC = "https://rpc.starknet.lava.build";
export const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

export function makeNetworkProvider(options = {}) {
  const legacyRpc = typeof options === "string" ? options : null;
  const config = typeof options === "object" ? options : {};
  const url = legacyRpc || config.rpcUrl ||
    (typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("rpc") : null) ||
    DEFAULT_MAINNET_RPC;
  return new RpcProvider({ nodeUrl: url, chainId: MAINNET_CHAIN_ID });
}

// Explorer link builders — pure functions.
// NOTE: call-data entrypoints are resolved with `hash.getSelectorFromName(...)`
// at the call site (see policy-reads.mjs) rather than hard-coded here. Hard
// coding felt252 selectors is error-prone; deriving them from the canonical
// entrypoint name keeps Studio aligned with the contracts' ABIs.
