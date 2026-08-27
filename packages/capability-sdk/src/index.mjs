/**
 * Pure BlackBox capability helpers.
 *
 * This package never receives viewing keys, private keys, or note plaintext.
 * A wallet/privacy client owns proof construction and note discovery. These
 * helpers validate public policy data and encode the Gatekeeper integration.
 */

export const CAPABILITY_UNIT = 1n;
export const OPEN_AMOUNT = "OPEN";

const FELT_MAX = (1n << 251n) + 17n * (1n << 192n);
const U128_MAX = (1n << 128n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

function asBigInt(value, label) {
  try {
    return typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new TypeError(`${label} must be an integer-compatible value.`);
  }
}

export function normalizeFelt(value, label = "felt") {
  const parsed = asBigInt(value, label);
  if (parsed < 0n || parsed > FELT_MAX) {
    throw new RangeError(`${label} is outside the Starknet felt252 range.`);
  }
  return `0x${parsed.toString(16)}`;
}

function normalizeUnsigned(value, maximum, label) {
  const parsed = asBigInt(value, label);
  if (parsed < 0n || parsed > maximum) {
    throw new RangeError(`${label} is outside its unsigned integer range.`);
  }
  return parsed;
}

function requireAddress(value, label) {
  const normalized = normalizeFelt(value, label);
  if (normalized === "0x0") throw new RangeError(`${label} cannot be zero.`);
  return normalized;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function rejectSecretFields(value, path = "deployment") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/(private|secret|mnemonic|viewing|credential|signer)/i.test(key)) {
      throw new Error(`${path}.${key} is secret material and is forbidden in a deployment plan.`);
    }
    rejectSecretFields(nested, `${path}.${key}`);
  }
}

/**
 * Builds a public, unsigned deployment plan for the flagship treasury adapter.
 * Symbolic `$...` references are resolved by a deployment tool only after each
 * preceding deployment is confirmed. This function never accepts a signer.
 */
export function buildTreasuryDeploymentPlan(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("deployment must be an object.");
  }
  rejectSecretFields(input);

  const network = requireText(input.network, "network");
  const privacyPool = requireAddress(input.privacyPool, "privacyPool");
  const issuer = requireAddress(input.issuer, "issuer");
  const treasury = requireAddress(input.treasury, "treasury");
  const asset = requireAddress(input.asset, "asset");
  const recipient = requireAddress(input.recipient, "recipient");
  const capabilityName = requireText(input.capabilityName, "capabilityName");
  const capabilitySymbol = requireText(input.capabilitySymbol, "capabilitySymbol");
  const maxAmount = normalizeUnsigned(input.maxAmount, U128_MAX, "maxAmount");
  const expiresAt = normalizeUnsigned(input.expiresAt, U64_MAX, "expiresAt");
  const supply = normalizeUnsigned(input.supply, U128_MAX, "supply");
  const treasuryAllowance = normalizeUnsigned(
    input.treasuryAllowance,
    U128_MAX,
    "treasuryAllowance",
  );
  if (maxAmount === 0n) throw new RangeError("maxAmount cannot be zero.");
  if (expiresAt === 0n) throw new RangeError("expiresAt cannot be zero.");
  if (supply === 0n) throw new RangeError("supply cannot be zero.");
  if (treasuryAllowance < maxAmount) {
    throw new RangeError("treasuryAllowance must cover at least one maximum payout.");
  }

  return Object.freeze({
    status: "UNSIGNED_PLAN",
    network,
    requiresOwnerApproval: true,
    declarations: Object.freeze([
      "CapabilityGatekeeper",
      "CapabilityToken",
      "TreasurySpendAdapter",
    ]),
    deployments: Object.freeze([
      Object.freeze({
        id: "gatekeeper",
        contract: "CapabilityGatekeeper",
        constructor: Object.freeze([privacyPool]),
      }),
      Object.freeze({
        id: "treasuryAdapter",
        contract: "TreasurySpendAdapter",
        constructor: Object.freeze(["$gatekeeper", treasury, asset, recipient]),
      }),
      Object.freeze({
        id: "capabilityToken",
        contract: "CapabilityToken",
        constructor: Object.freeze([
          capabilityName,
          capabilitySymbol,
          issuer,
          privacyPool,
          "$gatekeeper",
        ]),
      }),
    ]),
    setupCalls: Object.freeze([
      Object.freeze({
        signerRole: "issuer",
        contract: "$gatekeeper",
        entrypoint: "register_policy",
        arguments: Object.freeze([
          "$capabilityToken",
          "$treasuryAdapter",
          "selector:spend",
          true,
          normalizeFelt(maxAmount, "maxAmount"),
          normalizeFelt(expiresAt, "expiresAt"),
          requireBoolean(input.reusable, "reusable"),
        ]),
      }),
      Object.freeze({
        signerRole: "treasury",
        contract: asset,
        entrypoint: "approve",
        arguments: Object.freeze([
          "$treasuryAdapter",
          normalizeFelt(treasuryAllowance, "treasuryAllowance"),
        ]),
      }),
      Object.freeze({
        signerRole: "issuer",
        contract: "$capabilityToken",
        entrypoint: "mint",
        arguments: Object.freeze([issuer, normalizeFelt(supply, "supply")]),
      }),
    ]),
    privacySteps: Object.freeze([
      "The issuer approves the STRK20 pool for the minted supply, then uses a compatible wallet to deposit it and create private notes.",
      "Transfer one-unit private notes to capability holders.",
      "Use relayed outside execution; direct holder submission reveals the transaction sender.",
    ]),
    warnings: Object.freeze([
      "This plan contains no signer and cannot declare, deploy, approve, mint, or broadcast.",
      "Verify the privacy pool address and STRK20 service compatibility immediately before deployment.",
      "The shield deposit address, token, and amount are public.",
      "Mainnet execution requires explicit owner approval.",
    ]),
  });
}

export function validatePolicy(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("policy must be an object.");
  }
  const policy = {
    gatekeeper: requireAddress(input.gatekeeper, "gatekeeper"),
    capabilityToken: requireAddress(input.capabilityToken, "capabilityToken"),
    target: requireAddress(input.target, "target"),
    selector: requireAddress(input.selector, "selector"),
    enforceFirstArgMax: requireBoolean(input.enforceFirstArgMax, "enforceFirstArgMax"),
    maxFirstArg: normalizeUnsigned(input.maxFirstArg ?? 0n, U128_MAX, "maxFirstArg"),
    expiresAt: normalizeUnsigned(input.expiresAt, U64_MAX, "expiresAt"),
    reusable: requireBoolean(input.reusable, "reusable"),
    active: input.active === undefined ? true : requireBoolean(input.active, "active"),
  };
  if (policy.expiresAt === 0n) throw new RangeError("expiresAt cannot be zero.");
  return Object.freeze(policy);
}

export function buildRegisterPolicyCall(input) {
  const policy = validatePolicy(input);
  return {
    contractAddress: policy.gatekeeper,
    entrypoint: "register_policy",
    calldata: [
      policy.capabilityToken,
      policy.target,
      policy.selector,
      policy.enforceFirstArgMax ? "0x1" : "0x0",
      normalizeFelt(policy.maxFirstArg, "maxFirstArg"),
      normalizeFelt(policy.expiresAt, "expiresAt"),
      policy.reusable ? "0x1" : "0x0",
    ],
  };
}

export function buildPolicyStatusCall({ gatekeeper, capabilityToken, active }) {
  return {
    contractAddress: requireAddress(gatekeeper, "gatekeeper"),
    entrypoint: "set_policy_active",
    calldata: [
      requireAddress(capabilityToken, "capabilityToken"),
      active ? "0x1" : "0x0",
    ],
  };
}

export function encodeGatekeeperCalldata({
  capabilityToken,
  target,
  selector,
  targetCalldata = [],
  returnNoteId = 0n,
}) {
  if (!Array.isArray(targetCalldata)) {
    throw new TypeError("targetCalldata must be an array.");
  }
  const encodedTarget = targetCalldata.map((value, index) =>
    normalizeFelt(value, `targetCalldata[${index}]`),
  );
  return [
    requireAddress(capabilityToken, "capabilityToken"),
    requireAddress(target, "target"),
    requireAddress(selector, "selector"),
    normalizeFelt(BigInt(encodedTarget.length), "targetCalldata length"),
    ...encodedTarget,
    normalizeFelt(returnNoteId, "returnNoteId"),
  ];
}

function validateTargetCalldata(policy, targetCalldata) {
  if (!Array.isArray(targetCalldata)) {
    throw new TypeError("targetCalldata must be an array.");
  }
  if (!policy.enforceFirstArgMax) return;
  if (targetCalldata.length === 0) {
    throw new RangeError("targetCalldata requires a first argument for this policy.");
  }
  const firstArgument = normalizeUnsigned(
    targetCalldata[0],
    U128_MAX,
    "targetCalldata[0]",
  );
  if (firstArgument > policy.maxFirstArg) {
    throw new RangeError("targetCalldata[0] exceeds the public policy maximum.");
  }
}

/**
 * Returns an SDK-neutral plan consumed by the STRK20 wallet adapter.
 * `resolveInvoke(openNoteIds)` must be called after the privacy builder assigns
 * the reusable output note id.
 */
export function buildCapabilityInvokePlan({
  policy: rawPolicy,
  capabilityNoteId,
  targetCalldata = [],
  returnRecipient,
}) {
  const policy = validatePolicy(rawPolicy);
  if (!policy.active) throw new Error("Capability policy is inactive.");
  validateTargetCalldata(policy, targetCalldata);
  const noteId = normalizeFelt(capabilityNoteId, "capabilityNoteId");
  const recipient = policy.reusable
    ? requireAddress(returnRecipient, "returnRecipient")
    : null;

  return Object.freeze({
    capabilityToken: policy.capabilityToken,
    withdrawals: Object.freeze([
      Object.freeze({
        token: policy.capabilityToken,
        noteId,
        recipient: policy.gatekeeper,
        amount: CAPABILITY_UNIT,
      }),
    ]),
    openNotes: Object.freeze(
      policy.reusable
        ? [
            Object.freeze({
              token: policy.capabilityToken,
              recipient,
              amount: OPEN_AMOUNT,
            }),
          ]
        : [],
    ),
    resolveInvoke(openNoteIds = []) {
      if (policy.reusable && openNoteIds.length !== 1) {
        throw new Error("Reusable capability execution requires exactly one open note id.");
      }
      if (!policy.reusable && openNoteIds.length !== 0) {
        throw new Error("One-shot capability execution must not create an open note.");
      }
      return {
        contractAddress: policy.gatekeeper,
        entrypoint: "privacy_invoke",
        calldata: encodeGatekeeperCalldata({
          capabilityToken: policy.capabilityToken,
          target: policy.target,
          selector: policy.selector,
          targetCalldata,
          returnNoteId: policy.reusable ? openNoteIds[0] : 0n,
        }),
      };
    },
  });
}

/**
 * Builds the exact STRK20 Wallet API action list for a BlackBox capability.
 * The privacy-enabled wallet owns note selection, proof generation, relayed
 * submission, and `${openNoteIds[0]}` substitution.
 */
export function buildWalletApiCapabilityActions({
  policy: rawPolicy,
  targetCalldata = [],
  holderAddress,
}) {
  const policy = validatePolicy(rawPolicy);
  if (!policy.active) throw new Error("Capability policy is inactive.");
  validateTargetCalldata(policy, targetCalldata);
  const holder = policy.reusable
    ? requireAddress(holderAddress, "holderAddress")
    : null;
  const returnNoteId = policy.reusable ? "${openNoteIds[0]}" : "0x0";
  const invokeCalldata = encodeGatekeeperCalldata({
    capabilityToken: policy.capabilityToken,
    target: policy.target,
    selector: policy.selector,
    targetCalldata,
    returnNoteId: 0n,
  });
  invokeCalldata[invokeCalldata.length - 1] = returnNoteId;

  return Object.freeze([
    Object.freeze({
      type: "withdraw",
      token: policy.capabilityToken,
      amount: normalizeFelt(CAPABILITY_UNIT, "capability amount"),
      recipient: policy.gatekeeper,
    }),
    ...(policy.reusable
      ? [
          Object.freeze({
            type: "transfer",
            token: policy.capabilityToken,
            amount: OPEN_AMOUNT,
            recipient: holder,
          }),
        ]
      : []),
    Object.freeze({
      type: "invoke",
      contract: policy.gatekeeper,
      calldata: Object.freeze(invokeCalldata),
    }),
  ]);
}

/**
 * Builds the Wallet API action that converts publicly held issuer passes into
 * private STRK20 notes. ERC-20 approval is a separate public transaction.
 */
export function buildWalletApiCapabilityDepositActions({ capabilityToken, amount }) {
  const depositAmount = normalizeUnsigned(amount, U128_MAX, "amount");
  if (depositAmount === 0n) throw new RangeError("amount cannot be zero.");
  return Object.freeze([
    Object.freeze({
      type: "deposit",
      token: requireAddress(capabilityToken, "capabilityToken"),
      amount: normalizeFelt(depositAmount, "amount"),
    }),
  ]);
}

export function describeDisclosure({ reusable = false } = {}) {
  return Object.freeze({
    hidden: Object.freeze([
      "holder wallet from the Gatekeeper call; transaction-sender privacy requires a relay",
      "recipient of the private pass transfer",
      "issuance-to-use link, subject to STRK20 and metadata assumptions",
      ...(reusable ? ["owner of the returned open note"] : []),
    ]),
    public: Object.freeze([
      "capability token and policy class used",
      "target contract, selector, calldata, and timing",
      "public target state changes",
      ...(reusable ? ["returned open-note token and filled amount"] : []),
    ]),
    warnings: Object.freeze([
      "The initial shield deposit address, token, and amount are public.",
      "Direct proof submission reveals the submitting wallet; use relayed outside execution to keep the holder out of transaction metadata.",
      "The pass is a transferable bearer capability, not a human identity credential.",
      "Browser, RPC, wallet, and network metadata are outside the contract guarantee.",
    ]),
  });
}
