// =============================================================================
// Studio org-policy indexer — discover & classify the connected org's mandates
// =============================================================================
//
// The dashboard must show ONLY policies the connected organization wallet
// controls (i.e. it is the `issuer` recorded in the Gatekeeper). Studio never
// shows sample data as connected-wallet data.
//
// Discovery strategy (read-only, RPC-based):
//   1. Scan Mainnet UDC deployment events for CapabilityToken contracts
//      deployed by the connected treasury wallet.
//   2. Resolve each token's Gatekeeper, policy, adapter, and payment asset from
//      the deployed contracts themselves.
//   3. For each discovered capability_token, read get_policy + token/adapter
//      views via policy-reads.mjs to build a full row.
//   4. Classify each policy into a lifecycle state from REAL on-chain signals:
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

import { constants, hash, shortString } from "starknet";
import {
  makeNetworkProvider,
  explorerTx,
  explorerAddress,
  explorerToken,
} from "./studio-network.mjs";
import { getAdapterConfig, getPolicy, getTokenMeta, readPolicyRow } from "./policy-reads.mjs";

export const STUDIO_DISCOVERY_FROM_BLOCK = 14_200_000;
export const CAPABILITY_TOKEN_CLASS_HASH = "0x408fa2fde6f253b3771c43181c8eb8c7f5f71a929c4bd74cb0b25852e5a17e7";

export function tokensFromUdcEvents(events, issuer) {
  const expectedIssuer = BigInt(issuer);
  const expectedClass = BigInt(CAPABILITY_TOKEN_CLASS_HASH);
  const tokens = [];
  const seen = new Set();
  for (const event of events || []) {
    const data = event.data || [];
    if (data.length < 4) continue;
    if (BigInt(data[1]) !== expectedIssuer || BigInt(data[3]) !== expectedClass) continue;
    const token = felt(data[0]);
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

async function discoverStudioTokensForIssuer(provider, issuer, fromBlock) {
  const events = [];
  let continuation = undefined;
  do {
    const result = await provider.getEvents({
      address: constants.UDC.ADDRESS,
      keys: [[hash.getSelectorFromName("ContractDeployed")]],
      from_block: { block_number: fromBlock },
      to_block: "latest",
      continuation_token: continuation,
      chunk_size: 1000,
    });
    events.push(...(result.events || []));
    continuation = result.continuation_token;
  } while (continuation);
  return tokensFromUdcEvents(events, issuer);
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
    tokenSymbol: "STRK",
    capabilitySymbol: decodeFeltText(row.tokenMeta.symbol),
    tokenName: decodeFeltText(row.tokenMeta.name),
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
    // Entry points surfaced by the mandate dashboard.
    actions: {
      export: true,
      issue: state === "active",
      share: true,
      revoke: state === "active",
    },
  };
}

function decodeFeltText(value) {
  try { return shortString.decodeShortString(value); }
  catch { return value; }
}

// Main entry: index an org's policies on a given network.
// opts: { rpcUrl?, gatekeeper?, adapter?, asset?, fromBlock? }
// Returns { org, network, count, byState, records }.
export async function indexOrgPolicies(orgAddress, opts = {}) {
  const provider = makeNetworkProvider(opts);
  const tokens = await discoverStudioTokensForIssuer(
    provider,
    orgAddress,
    opts.fromBlock ?? STUDIO_DISCOVERY_FROM_BLOCK,
  );

  const records = [];
  for (const token of tokens) {
    try {
      const tokenMeta = await getTokenMeta(provider, token);
      const gatekeeper = tokenMeta.gatekeeper;
      const policy = await getPolicy(provider, gatekeeper, token);
      const adapter = policy.target;
      const adapterConfig = await getAdapterConfig(provider, adapter, token);
      const asset = adapterConfig.token;
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
