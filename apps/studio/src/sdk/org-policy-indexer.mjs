// =============================================================================
// Studio org-policy indexer — discover & classify the connected org's mandates
// =============================================================================
//
// The dashboard must show ONLY policies the connected organization wallet
// controls (i.e. it is the `issuer` recorded in the Gatekeeper). Studio never
// shows sample data as connected-wallet data (IMPLEMENTATION_PLAN.md Phase 5
// gate).
//
// Discovery strategy (read-only, RPC-based):
//   1. Scan the Gatekeeper's `PolicyRegistered` events. The event's `issuer`
//      field is a #[key], so we filter events by `issuer = <connected wallet>`.
//   2. For each discovered capability_token, read get_policy + token/adapter
//      views via policy-reads.mjs to build a full row.
//   3. Classify each policy into a lifecycle state from REAL on-chain signals:
//        - active   : get_policy.active == true AND now <= expires_at
//        - expired  : now > expires_at (regardless of active flag)
//        - revoked  : get_policy.active == false AND now < expires_at
//        - draft    : the token exists but get_policy returns zero issuer
//                    (not yet registered) — i.e. a local in-progress config
//   4. Compute public budget = allowance(treasury, adapter) - adapter.total_spent
//      and uses count from get_policy.uses.
//
// The indexer NEVER invents rows. If the org has zero registered policies, it
// returns an empty list and the dashboard renders its empty state.
// =============================================================================

import { hash } from "starknet";
import {
  makeNetworkProvider,
  explorerTx,
  explorerAddress,
  explorerToken,
} from "./studio-network.mjs";
import { readPolicyRow } from "./policy-reads.mjs";

// Compute the `PolicyRegistered` event key hash for filtering by issuer.
// starknet.js getEvents takes `keys: [[key0, key1, ...]]` where each key is a
// felt; for an event with two #[key] fields (capability_token, issuer), the
// key array is [eventKey, capability_token?, issuer?]. We filter on issuer as
// the second key.
function policyRegisteredEventKey() {
  return hash.getSelectorFromName("PolicyRegistered");
}

// Scan all `PolicyRegistered` events on the Gatekeeper and filter by `issuer`
// client-side. The event's `#[key]` fields are emitted as:
//   keys[0] = event selector (hash("PolicyRegistered"))
//   keys[1] = capability_token   (first #[key])
//   keys[2] = issuer              (second #[key])
// Server-side wildcard at position 1 is unreliable across RPC providers, so we
// paginate all events and match issuer from keys[2]. For a single Studio
// Gatekeeper the volume is tiny; this is correct and provider-agnostic.
async function discoverTokensForIssuer(provider, gatekeeper, issuer, fromBlock = 0) {
  const eventKey = policyRegisteredEventKey();
  const issuerFelt = BigInt(issuer).toString();
  const tokens = [];
  const seen = new Set();
  let continuation = undefined;
  do {
    const res = await provider.getEvents({
      address: gatekeeper,
      keys: [[eventKey]], // match the event selector only; filter issuer below
      from_block: { block_number: fromBlock },
      to_block: "latest",
      continuation_token: continuation,
      chunk_size: 100,
    });
    for (const ev of res.events || []) {
      const evIssuer = ev.keys && ev.keys[2] ? felt(ev.keys[2]) : null;
      const token = ev.keys && ev.keys[1] ? felt(ev.keys[1]) : null;
      if (!token || !evIssuer) continue;
      if (BigInt(evIssuer).toString() !== issuerFelt) continue; // org-owned only
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
    continuation = res.continuation_token;
  } while (continuation);
  return tokens;
}

function felt(v) {
  // Minimal-form hex (no leading zeros), matching policy-reads feltToHex so
  // discovered tokens compare cleanly against address constants/explorer links.
  let hex = BigInt(v).toString(16).replace(/^0+/, "");
  if (hex === "") hex = "0";
  return `0x${hex}`;
}

// Classify a policy row into a lifecycle state using only on-chain signals.
// NOTE: expiresAt === 0 means "never expires" in the CapabilityGatekeeper
// contract (the deployed Studio policies use 0). Treat 0 as active, not expired.
export function classifyPolicy(row, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  if (!row || !row.policy) return "draft";
  const { active, expiresAt } = row.policy;
  // The contract permits a use at the exact expiry timestamp (`<=`).
  if (expiresAt !== 0 && nowSec > expiresAt) return "expired";
  if (active) return "active";
  return "revoked";
}

// Build a dashboard-ready record from a raw policy row + discovery metadata.
export function toDashboardRecord(row, { discoveredAtBlock, registerTx } = {}) {
  const state = classifyPolicy(row);
  return {
    state,
    token: row.token,
    gatekeeper: row.gatekeeper,
    adapter: row.adapter,
    asset: row.asset,
    // Policy fields
    issuer: row.policy.issuer,
    target: row.policy.target,
    selector: row.policy.selector,
    enforceFirstArgMax: row.policy.enforceFirstArgMax,
    maxFirstArg: row.policy.maxFirstArg.toString(),
    expiresAt: row.policy.expiresAt,
    reusable: row.policy.reusable,
    active: row.policy.active,
    uses: row.policy.uses,
    // Token / spend (all metadata is read from the public token contract)
    tokenSymbol: row.tokenMeta.symbol,
    tokenName: row.tokenMeta.name,
    tokenTotalSupply: row.tokenMeta.totalSupply.toString(),
    privacyPool: row.tokenMeta.privacyPool,
    tokenGatekeeper: row.tokenMeta.gatekeeper,
    treasury: row.adapterConfig.treasury,
    recipient: row.adapterConfig.recipient,
    totalSpent: row.totalSpent.toString(),
    allowance: row.allowance.toString(),
    remainingBudget: row.remainingBudget.toString(),
    // Links (real, explorer-based)
    links: {
      token: explorerToken(row.token),
      gatekeeper: explorerAddress(row.gatekeeper),
      adapter: explorerAddress(row.adapter),
      registerTx: registerTx ? explorerTx(registerTx) : null,
    },
    // Entry points the dashboard surfaces (Phase 5 only renders buttons;
    // Phase 6/7 wire the actual actions).
    actions: {
      export: true,
      issue: state === "active",
      share: true,
      revoke: state === "active",
    },
  };
}

// Main entry: index an org's policies on a given network.
// opts: { rpcUrl?, gatekeeper?, adapter?, asset?, fromBlock? }
// Returns { org, network, count, byState, records }.
export async function indexOrgPolicies(orgAddress, opts = {}) {
  const provider = makeNetworkProvider(opts);
  const gatekeeper = opts.gatekeeper;
  const adapter = opts.adapter;
  const asset = opts.asset;
  if (!gatekeeper || !adapter || !asset) {
    const err = new Error(
      "Studio network contract configuration is missing; supply gatekeeper, adapter, and asset from the integration runtime.",
    );
    err.code = "CONFIGURATION_REQUIRED";
    throw err;
  }

  const tokens = await discoverTokensForIssuer(
    provider,
    gatekeeper,
    orgAddress,
    opts.fromBlock ?? 0,
  );

  const records = [];
  for (const token of tokens) {
    try {
      const row = await readPolicyRow(provider, {
        gatekeeper,
        token,
        adapter,
        asset,
      });
      records.push(toDashboardRecord(row));
    } catch (e) {
      // A token keyed in the event but with no live policy (e.g. revoked and
      // storage cleared) is skipped — we never fabricate a row.
      if (e && e.code === "NO_POLICY") continue;
      throw e;
    }
  }

  const byState = { active: 0, expired: 0, revoked: 0, draft: 0 };
  for (const r of records) byState[r.state] = (byState[r.state] || 0) + 1;

  return {
    org: orgAddress,
    network: "mainnet",
    count: records.length,
    byState,
    records,
  };
}
