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
export const FALLBACK_MAINNET_RPC = "https://starknet-rpc.publicnode.com";
export const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

export function makeReadProvider(urls, createProvider = (nodeUrl) => new RpcProvider({ nodeUrl, chainId: MAINNET_CHAIN_ID })) {
  const providers = [...new Set(urls.filter(Boolean))].map(
    (nodeUrl) => createProvider(nodeUrl),
  );
  const read = async (method, args) => {
    let lastError;
    for (const provider of providers) {
      try {
        return await provider[method](...args);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No Mainnet RPC is configured.");
  };
  return Object.freeze({
    callContract: (...args) => read("callContract", args),
    getEvents: (...args) => read("getEvents", args),
    getTransactionReceipt: (...args) => read("getTransactionReceipt", args),
    getBlockNumber: (...args) => read("getBlockNumber", args),
  });
}

export function makeNetworkProvider(options = {}) {
  const legacyRpc = typeof options === "string" ? options : null;
  const config = typeof options === "object" ? options : {};
  const url = legacyRpc || config.rpcUrl ||
    (typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("rpc") : null) ||
    DEFAULT_MAINNET_RPC;
  return makeReadProvider([url, FALLBACK_MAINNET_RPC]);
}

// Explorer link builders — pure functions.
// NOTE: call-data entrypoints are resolved with `hash.getSelectorFromName(...)`
// at the call site (see policy-reads.mjs) rather than hard-coded here. Hard
// coding felt252 selectors is error-prone; deriving them from the canonical
// entrypoint name keeps Studio aligned with the contracts' ABIs.
