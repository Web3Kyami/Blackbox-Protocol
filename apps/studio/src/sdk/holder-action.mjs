// =============================================================================
// Executes only the action defined by the selected policy.
// =============================================================================
//
// The privacy-enabled wallet owns note selection, proof generation, and
// submission. Studio only assembles the action list from a real policy.
// =============================================================================

import { buildWalletApiCapabilityActions } from "./blackbox-capability-sdk.mjs";

// Build the holder action list from a normalized policy record. Reuses the
// upstream SDK verbatim so the calldata matches what a real STRK20 wallet
// adapter would execute against Gatekeeper.privacy_invoke.
//
// record: a dashboard record that must carry the policy fields
//         (gatekeeper, capabilityToken, target, selector, enforceFirstArgMax,
//          maxFirstArg, reusable, active) plus asset.
// targetCalldata: the amount/args the holder exercises (e.g. ["0x1"] for a
//                 one-unit payment; checked against maxFirstArg by the SDK).
// holderAddress: required only for reusable policies (where the open note is
//                returned to the holder).
export function buildHolderAction(record, targetCalldata = ["0x1"], holderAddress = null) {
  if (!record) throw new TypeError("buildHolderAction requires a normalized policy record.");
  // Accept either a nested policy (record.policy) or a flat dashboard record.
  // The SDK's buildWalletApiCapabilityActions needs gatekeeper + capabilityToken
  // + target + selector + enforceFirstArgMax + maxFirstArg + reusable + active,
  // all as integer-compatible values.
  const p = record.policy || record;
  const rawPolicy = {
    gatekeeper: p.gatekeeper || record.gatekeeper,
    capabilityToken: p.capabilityToken || record.token,
    target: p.target || record.target,
    selector: p.selector || record.selector,
    enforceFirstArgMax: p.enforceFirstArgMax ?? record.enforceFirstArgMax,
    maxFirstArg: p.maxFirstArg ?? record.maxFirstArg,
    expiresAt: p.expiresAt ?? record.expiresAt,
    reusable: p.reusable ?? record.reusable,
    active: p.active ?? record.active,
    uses: p.uses ?? record.uses,
  };
  return buildWalletApiCapabilityActions({
    policy: rawPolicy,
    targetCalldata,
    holderAddress,
  });
}
