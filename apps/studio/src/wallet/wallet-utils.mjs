// =============================================================================
// Studio provenance banner — wallet utilities
// =============================================================================
//
// This file is a copy of the upstream wallet helper module that lives at
//   ../../apps/web/src/wallet-operator.mjs
// (relative to this file), inside the parent BlackBox Protocol repository.
//
// Upstream identity
// -----------------
//   path:        apps/web/src/wallet-operator.mjs
//   bytes:       2340
//   lines:       71
//   sha256:      ae1128a94f9d2cc7fadb0cb0a446d7177e9a6c3b3c8f7f55fd7d724e7270891a
//
// Why this copy exists
// --------------------
// Studio must not depend on a relative path that points outside
// `apps/studio/`. `apps/studio/AGENTS.md` forbids that shape. Copying the
// proven wallet helpers in here keeps Studio shippable on its own.
//
// What this copy preserves
// ------------------------
// - The body of the file is byte-identical to the upstream snapshot
//   recorded above. No rewrites, no formatting changes, no edits.
// - Studio depends on the following exports:
//     MAINNET_CHAIN_ID, requirePrivacyWalletFeature, parseTargetCalldata,
//     actionFingerprint, isExamplePolicy, relaySeparation,
//     walletErrorMessage, shortHex.
//
// Parity proof
// ------------
// The parity check for this file is a byte-level sha256 of the body
// section compared to the upstream file. A future independent review can
// re-run the same check with `tail -n +<banner+1> <file> | sha256sum`
// against the upstream sha256 above.
//
// The original file content begins on the line immediately after this
// banner. Do not edit the body — edit the upstream and re-copy.
// =============================================================================

export const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

export function requirePrivacyWalletFeature(wallet) {
  const request = wallet?.features?.["starknet:walletApi"]?.request;
  if (typeof request !== "function") {
    throw new Error("This wallet does not expose the Starknet Wallet API.");
  }
  return wallet;
}

export function parseTargetCalldata(value) {
  if (typeof value !== "string") {
    throw new TypeError("Target calldata must be text.");
  }
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((item, index) => {
    const part = item.trim();
    if (!part) throw new Error(`Target calldata item ${index + 1} is empty.`);
    try {
      return BigInt(part);
    } catch {
      throw new Error(`Target calldata item ${index + 1} is not an integer or felt.`);
    }
  });
}

export function actionFingerprint(actions) {
  if (!Array.isArray(actions)) throw new TypeError("Actions must be an array.");
  return JSON.stringify(actions);
}

export function isExamplePolicy(policy) {
  return (
    policy?.gatekeeper === "0x100" ||
    policy?.capabilityToken === "0x200" ||
    policy?.target === "0x300" ||
    policy?.selector === "0x400"
  );
}

export function relaySeparation({ holderAddress, senderAddress }) {
  try {
    const holder = BigInt(holderAddress);
    const sender = BigInt(senderAddress);
    return Object.freeze({
      verified: holder !== sender,
      holder: `0x${holder.toString(16)}`,
      sender: `0x${sender.toString(16)}`,
    });
  } catch {
    return Object.freeze({ verified: false, holder: null, sender: null });
  }
}

export function walletErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel/i.test(message)) return "The wallet request was rejected.";
  if (/insufficient|note|balance/i.test(message)) {
    return "The wallet could not find enough private capability balance for this action.";
  }
  if (/unsupported|not support|not implemented|method/i.test(message)) {
    return "The connected wallet does not support the required STRK20 action.";
  }
  return message || "The wallet request failed.";
}

export function shortHex(value) {
  if (typeof value !== "string" || value.length < 14) return value || "—";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
