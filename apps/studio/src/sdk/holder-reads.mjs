// =============================================================================
// Studio holder read layer — Phase 7 (Dynamic holder experience)
// =============================================================================
//
// Read-only. Loads a public Capability Token policy from its on-chain
// address (the form the shared holder link carries) and normalizes it into
// the SAME dashboard record shape used by Phase 5/6, so the holder view and
// the issuer dashboard share one record contract.
//
// No policy/issuer/holder/token/adapter address is hardcoded — the holder
// link supplies token + gatekeeper + adapter (or they are read from the
// token's own get_gatekeeper()/adapter via the public Token/Gatekeeper views).
//
// The holder *action* calldata is built by the upstream SDK's
// buildWalletApiCapabilityActions() (Gatekeeper.privacy_invoke) — Studio
// never invents calldata. This module only reads + assembles the record.
// =============================================================================

import { makeNetworkProvider } from "./studio-network.mjs";
import { getPolicy, getTokenMeta, readPolicyRow } from "./policy-reads.mjs";
import { getAdapterConfig } from "./policy-reads.mjs";
import { toDashboardRecord, classifyPolicy } from "./org-policy-indexer.mjs";

// Load a single policy record by its token address. The shared holder link
// carries at minimum `token`; gatekeeper/adapter are resolved from the real
// on-chain token and policy wiring unless explicitly supplied for a read test.
// opts: { rpcUrl?, gatekeeper?, adapter?, asset? }
// Returns the normalized record (shape identical to indexOrgPolicies records).
export async function loadHolderPolicy(token, opts = {}) {
  if (!token) throw new TypeError("token address is required to load a holder policy.");
  const provider = makeNetworkProvider(opts);
  try {
    // Resolve the token's public wiring first. The token owns the
    // get_gatekeeper/get_privacy_pool relationship; the holder link must not
    // assume Studio's deployed addresses for an arbitrary policy token.
    const tokenMeta = await getTokenMeta(provider, token);
    const gatekeeper = opts.gatekeeper || tokenMeta.gatekeeper;
    const policy = await getPolicy(provider, gatekeeper, token);
    const adapter = opts.adapter || policy.target;
    const adapterConfig = await getAdapterConfig(provider, adapter, token);
    const asset = opts.asset || adapterConfig.token;
    const row = await readPolicyRow(provider, { gatekeeper, token, adapter, asset });
    const record = toDashboardRecord(row);
    // Attach a nested `policy` object so downstream SDK calls
    // (buildWalletApiCapabilityActions expects policy.gatekeeper/target/
    // capabilityToken) and classifyPolicy work on the same record shape.
    record.policy = {
      gatekeeper: record.gatekeeper,
      capabilityToken: record.token,
      target: record.target,
      selector: record.selector,
      enforceFirstArgMax: record.enforceFirstArgMax,
      maxFirstArg: record.maxFirstArg,
      expiresAt: record.expiresAt,
      reusable: record.reusable,
      active: record.active,
      uses: record.uses,
    };
    return record;
  } catch (e) {
    // The shared link must point at a real Capability Token. If the address
    // is not a token (an account, the gatekeeper, etc.) the view entrypoints
    // throw a raw RPC error — we surface it as a clear, non-fabricated error
    // rather than a fake record.
    if (e && e.code === "NO_POLICY") {
      const err = new Error(`No active policy found for capability token ${token}.`);
      err.code = "NO_POLICY";
      throw err;
    }
    const err = new Error(`No active policy: address ${token} has no BlackBox capability policy (not a capability token, or RPC error: ${e?.message || e}).`);
    err.code = "NO_POLICY";
    throw err;
  }
}

// Derive the holder link for a given token (real explorer/Voyager base).
// The link is just a deep link into this Studio app; the token is the only
// required identity. We never embed issuer/holder/adapter secrets in it.
export function holderLink(token, opts = {}) {
  if (!token) throw new TypeError("token is required to build a holder link.");
  const base = opts.baseUrl || "";
  return `${base}?policy=${encodeURIComponent(token)}`;
}

// A share/export payload contains only public policy facts. It intentionally
// excludes any claim about the private-note holder or wallet-owned proof data.
export function policyExport(record) {
  if (!record) throw new TypeError("record is required to export a policy.");
  return Object.freeze({
    network: "mainnet",
    token: record.token,
    gatekeeper: record.gatekeeper,
    adapter: record.adapter,
    asset: record.asset,
    recipient: record.recipient,
    maxAmount: record.maxFirstArg,
    expiresAt: record.expiresAt,
    reusable: record.reusable,
    active: record.active,
    state: record.state,
    holderLink: holderLink(record.token),
  });
}

// Re-export so the holder view can classify state with one import.
export { classifyPolicy };
