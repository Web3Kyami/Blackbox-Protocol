// Browser-safe public configuration and explorer links. This module must stay
// dependency-free so opening Studio does not download the Starknet RPC stack.
export const VOYAGER_BASE = "https://voyager.online";

export function readRuntimeNetworkConfig() {
  if (typeof window === "undefined") return null;
  const config = window.__BLACKBOX_STUDIO_CONFIG__?.network;
  if (!config || typeof config !== "object") return null;
  return {
    network: config.network || "mainnet",
    rpcUrl: config.rpcUrl || null,
    gatekeeper: config.gatekeeper || null,
    adapter: config.adapter || null,
    asset: config.asset || null,
    privacyPool: config.privacyPool || null,
  };
}

export function explorerTx(txHash) { return `${VOYAGER_BASE}/tx/${txHash}`; }
export function explorerAddress(addr) { return `${VOYAGER_BASE}/contract/${addr}`; }
export function explorerToken(addr) { return `${VOYAGER_BASE}/token/${addr}`; }
