// =============================================================================
// Studio read layer — public on-chain views for the dashboard
// =============================================================================
//
// Read-only. Every function calls a deployed contract's VIEW entrypoint via an
// RpcProvider. No writes, no signing. All selectors are derived with
// hash.getSelectorFromName (never hard-coded) so they stay correct if the
// contract surface changes.
//
// Contract view entrypoints (from contracts/src/*.cairo, authoritative):
//   CapabilityGatekeeper.get_policy(token)      -> (issuer, target, selector,
//                                                  enforceFirstArgMax, maxFirstArg,
//                                                  expiresAt, reusable, active, uses)
//   CapabilityToken.get_issuer()                -> ContractAddress   (no args)
//   CapabilityToken.get_privacy_pool()          -> ContractAddress   (no args)
//   CapabilityToken.get_gatekeeper()            -> ContractAddress   (no args)
//   TreasurySpendAdapter.get_config()           -> (gatekeeper, treasury,
//                                                  token, recipient)  (no args)
//   TreasurySpendAdapter.get_total_spent()      -> u256             (no args)
//   ERC-20 (asset).allowance(owner, spender)    -> u256             (2 args)
//
// CapabilityToken also exposes public name/symbol/total_supply views. Read
// those values instead of inventing a display label from the asset.
// =============================================================================

import { RpcProvider, hash } from "starknet";

const sel = (name) => hash.getSelectorFromName(name);

// Normalize a felt returned by callContract into a canonical 0x-prefixed
// MINIMAL hex string (no leading zeros, matching how contract addresses are
// written in constants and explorers). Felt252 addresses have no significant
// leading zeros, so stripping them keeps on-chain values comparable to the
// project's address constants.
function feltToHex(v) {
  let hex = BigInt(v).toString(16).replace(/^0+/, "");
  if (hex === "") hex = "0";
  return `0x${hex}`;
}

// Call a view entrypoint. Returns the raw result array (felt strings).
async function callView(provider, contract, entrypoint, calldata = []) {
  const res = await provider.callContract({
    contractAddress: contract,
    entrypoint,
    calldata,
  });
  // Some RPC providers return {result:[...]} (object) or a bare array.
  return Array.isArray(res) ? res : res.result;
}

// Read a single u256/ContractAddress view that returns one felt.
async function readOne(provider, contract, entrypoint, calldata = []) {
  const r = await callView(provider, contract, entrypoint, calldata);
  return r && r.length ? r[0] : "0x0";
}

// Uint256 (two felts: low, high) -> decimal string.
function u256ToDecimal(arr) {
  const low = BigInt(arr[0] ?? "0x0");
  const high = BigInt(arr[1] ?? "0x0");
  return (high << 128n) + low;
}

// -----------------------------------------------------------------------------
// Per-contract view helpers
// -----------------------------------------------------------------------------

// Gatekeeper.get_policy(token) -> normalized policy object.
export async function getPolicy(provider, gatekeeper, token) {
  const r = await callView(provider, gatekeeper, "get_policy", [token]);
  if (!r || r.length < 9) {
    const err = new Error("get_policy returned an unexpected shape");
    err.code = "NO_POLICY";
    throw err;
  }
  const [issuer, target, selector, enforceFirstArgMax, maxFirstArg, expiresAt, reusable, active, uses] = r;
  return {
    issuer: feltToHex(issuer),
    target: feltToHex(target),
    selector: BigInt(selector).toString(),
    enforceFirstArgMax: BigInt(enforceFirstArgMax) === 1n,
    maxFirstArg: BigInt(maxFirstArg).toString(),
    expiresAt: Number(BigInt(expiresAt)),
    reusable: BigInt(reusable) === 1n,
    active: BigInt(active) === 1n,
    uses: Number(BigInt(uses)),
  };
}

// CapabilityToken control views (issuer/pool/gatekeeper).
export async function getTokenMeta(provider, token) {
  return {
    name: feltToHex(await readOne(provider, token, "name")),
    symbol: feltToHex(await readOne(provider, token, "symbol")),
    totalSupply: u256ToDecimal(await callView(provider, token, "total_supply")),
    issuer: feltToHex(await readOne(provider, token, "get_issuer")),
    privacyPool: feltToHex(await readOne(provider, token, "get_privacy_pool")),
    gatekeeper: feltToHex(await readOne(provider, token, "get_gatekeeper")),
  };
}

// TreasurySpendAdapter config + total spent. Both views take no calldata.
export async function getAdapterConfig(provider, adapter, token) {
  const cfg = await callView(provider, adapter, "get_config");
  const totalSpent = u256ToDecimal(
    await callView(provider, adapter, "get_total_spent"),
  );
  return {
    gatekeeper: feltToHex(cfg[0]),
    treasury: feltToHex(cfg[1]),
    token: feltToHex(cfg[2]),
    recipient: feltToHex(cfg[3]),
    totalSpent,
  };
}

// ERC-20 allowance(owner, spender) -> decimal string (public budget ceiling).
export async function getAllowance(provider, asset, owner, spender) {
  const r = await callView(provider, asset, "allowance", [owner, spender]);
  return u256ToDecimal(r).toString();
}

// ERC-20 transfer_from reduces allowance as each payment succeeds. The current
// allowance is therefore already the remaining hard payment budget. Keep
// totalSpent as separate history, but never subtract it from allowance again.
export function remainingBudgetFromAllowance(allowance) {
  const value = BigInt(allowance);
  if (value < 0n) throw new RangeError("allowance cannot be negative");
  return value.toString();
}

// -----------------------------------------------------------------------------
// Aggregate: read everything needed for one dashboard row.
// -----------------------------------------------------------------------------
export async function readPolicyRow(provider, { gatekeeper, token, adapter, asset }) {
  const policy = await getPolicy(provider, gatekeeper, token);
  const tokenMeta = await getTokenMeta(provider, token);
  const adapterConfig = await getAdapterConfig(provider, adapter, token);
  const expectedGatekeeper = feltToHex(gatekeeper);
  if (tokenMeta.gatekeeper !== expectedGatekeeper) {
    const err = new Error("capability token is controlled by a different gatekeeper");
    err.code = "NO_POLICY";
    throw err;
  }
  if (
    policy.target !== feltToHex(adapter) ||
    adapterConfig.gatekeeper !== expectedGatekeeper ||
    adapterConfig.token !== feltToHex(asset)
  ) {
    const err = new Error("adapter configuration does not match the requested policy");
    err.code = "NO_POLICY";
    throw err;
  }
  const allowance = await getAllowance(
    provider,
    asset,
    adapterConfig.treasury,
    adapter,
  );
  return {
    token,
    gatekeeper,
    adapter,
    asset,
    policy,
    tokenMeta,
    adapterConfig,
    allowance,
    totalSpent: adapterConfig.totalSpent,
    remainingBudget: remainingBudgetFromAllowance(allowance),
  };
}

// Re-export for callers that build providers directly.
export { RpcProvider };
