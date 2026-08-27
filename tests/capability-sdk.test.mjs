import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_UNIT,
  OPEN_AMOUNT,
  buildCapabilityInvokePlan,
  buildPolicyStatusCall,
  buildRegisterPolicyCall,
  buildTreasuryDeploymentPlan,
  buildWalletApiCapabilityDepositActions,
  buildWalletApiCapabilityActions,
  describeDisclosure,
  encodeGatekeeperCalldata,
  normalizeFelt,
  validatePolicy,
} from "../packages/capability-sdk/src/index.mjs";

const reusablePolicy = {
  gatekeeper: "0x100",
  capabilityToken: "0x200",
  target: "0x300",
  selector: "0x400",
  enforceFirstArgMax: true,
  maxFirstArg: 5_000n,
  expiresAt: 2_000_000_000n,
  reusable: true,
};

test("validates and normalizes a public capability policy", () => {
  const policy = validatePolicy(reusablePolicy);
  assert.equal(policy.gatekeeper, "0x100");
  assert.equal(policy.maxFirstArg, 5_000n);
  assert.equal(policy.active, true);
  assert.equal(policy.reusable, true);
});

test("rejects zero addresses and values outside felt range", () => {
  assert.throws(() => validatePolicy({ ...reusablePolicy, target: 0 }), /cannot be zero/);
  assert.throws(() => normalizeFelt(1n << 252n), /felt252 range/);
  assert.throws(
    () => validatePolicy({ ...reusablePolicy, reusable: "false" }),
    /reusable must be a boolean/,
  );
  assert.throws(
    () => validatePolicy({ ...reusablePolicy, enforceFirstArgMax: "true" }),
    /enforceFirstArgMax must be a boolean/,
  );
});

test("encodes register and class revocation calls", () => {
  const register = buildRegisterPolicyCall(reusablePolicy);
  assert.equal(register.entrypoint, "register_policy");
  assert.deepEqual(register.calldata, [
    "0x200",
    "0x300",
    "0x400",
    "0x1",
    "0x1388",
    "0x77359400",
    "0x1",
  ]);

  assert.deepEqual(
    buildPolicyStatusCall({ gatekeeper: "0x100", capabilityToken: "0x200", active: false }),
    {
      contractAddress: "0x100",
      entrypoint: "set_policy_active",
      calldata: ["0x200", "0x0"],
    },
  );
});

test("encodes Cairo Span calldata for Gatekeeper privacy_invoke", () => {
  assert.deepEqual(
    encodeGatekeeperCalldata({
      capabilityToken: "0x200",
      target: "0x300",
      selector: "0x400",
      targetCalldata: [75n, "0xabc"],
      returnNoteId: "0x999",
    }),
    ["0x200", "0x300", "0x400", "0x2", "0x4b", "0xabc", "0x999"],
  );
});

test("builds reusable withdrawal, open-note, and invoke plan", () => {
  const plan = buildCapabilityInvokePlan({
    policy: reusablePolicy,
    capabilityNoteId: "0x555",
    targetCalldata: [75n],
    returnRecipient: "0x777",
  });
  assert.equal(plan.withdrawals[0].amount, CAPABILITY_UNIT);
  assert.equal(plan.withdrawals[0].recipient, "0x100");
  assert.equal(plan.openNotes[0].amount, OPEN_AMOUNT);
  const invoke = plan.resolveInvoke(["0x999"]);
  assert.equal(invoke.contractAddress, "0x100");
  assert.deepEqual(invoke.calldata.slice(-3), ["0x1", "0x4b", "0x999"]);
  assert.throws(() => plan.resolveInvoke([]), /exactly one open note/);
});

test("builds one-shot plan without an invented return note", () => {
  const plan = buildCapabilityInvokePlan({
    policy: { ...reusablePolicy, reusable: false },
    capabilityNoteId: "0x555",
    targetCalldata: [42n],
  });
  assert.equal(plan.openNotes.length, 0);
  assert.equal(plan.resolveInvoke().calldata.at(-1), "0x0");
  assert.throws(() => plan.resolveInvoke(["0x999"]), /must not create/);
});

test("builds reusable STRK20 Wallet API actions with an open-note placeholder", () => {
  const actions = buildWalletApiCapabilityActions({
    policy: reusablePolicy,
    holderAddress: "0x777",
    targetCalldata: [75n],
  });
  assert.deepEqual(actions, [
    { type: "withdraw", token: "0x200", amount: "0x1", recipient: "0x100" },
    { type: "transfer", token: "0x200", amount: "OPEN", recipient: "0x777" },
    {
      type: "invoke",
      contract: "0x100",
      calldata: ["0x200", "0x300", "0x400", "0x1", "0x4b", "${openNoteIds[0]}"],
    },
  ]);
});

test("builds one-shot Wallet API actions and rejects client-side limit violations", () => {
  const actions = buildWalletApiCapabilityActions({
    policy: { ...reusablePolicy, reusable: false },
    targetCalldata: [42n],
  });
  assert.equal(actions.length, 2);
  assert.equal(actions.at(-1).calldata.at(-1), "0x0");
  assert.throws(
    () =>
      buildWalletApiCapabilityActions({
        policy: reusablePolicy,
        holderAddress: "0x777",
        targetCalldata: [5_001n],
      }),
    /exceeds the public policy maximum/,
  );
  assert.throws(
    () =>
      buildCapabilityInvokePlan({
        policy: reusablePolicy,
        capabilityNoteId: "0x555",
        targetCalldata: [],
        returnRecipient: "0x777",
      }),
    /requires a first argument/,
  );
});

test("builds the issuer Wallet API deposit after its separate public approval", () => {
  assert.deepEqual(
    buildWalletApiCapabilityDepositActions({ capabilityToken: "0x200", amount: 10n }),
    [{ type: "deposit", token: "0x200", amount: "0xa" }],
  );
  assert.throws(
    () => buildWalletApiCapabilityDepositActions({ capabilityToken: "0x200", amount: 0n }),
    /cannot be zero/,
  );
});

test("disclosure model never calls shielding private", () => {
  const disclosure = describeDisclosure({ reusable: true });
  assert.ok(disclosure.hidden.some((entry) => entry.includes("holder wallet")));
  assert.ok(disclosure.public.some((entry) => entry.includes("target contract")));
  assert.ok(disclosure.warnings.some((entry) => entry.includes("shield deposit")));
  assert.ok(disclosure.warnings.some((entry) => entry.includes("Direct proof submission")));
  assert.equal(JSON.stringify(disclosure).includes("shielding is private"), false);
});

test("builds an unsigned dependency-ordered treasury deployment plan", () => {
  const plan = buildTreasuryDeploymentPlan({
    network: "SN_MAIN",
    privacyPool: "0x111",
    issuer: "0x222",
    treasury: "0x333",
    asset: "0x444",
    recipient: "0x555",
    capabilityName: "Treasury Payout",
    capabilitySymbol: "BB_PAY",
    maxAmount: 5_000n,
    expiresAt: 2_000_000_000n,
    reusable: true,
    supply: 10n,
    treasuryAllowance: 50_000n,
  });

  assert.equal(plan.status, "UNSIGNED_PLAN");
  assert.equal(plan.requiresOwnerApproval, true);
  assert.deepEqual(plan.declarations, [
    "CapabilityGatekeeper",
    "CapabilityToken",
    "TreasurySpendAdapter",
  ]);
  assert.deepEqual(plan.deployments[1].constructor, [
    "$gatekeeper",
    "0x333",
    "0x444",
    "0x555",
  ]);
  assert.equal(plan.setupCalls[0].arguments[2], "selector:spend");
  assert.equal(plan.setupCalls[0].arguments[4], "0x1388");
  assert.deepEqual(plan.setupCalls.at(-1).arguments, ["0x222", "0xa"]);
  assert.ok(plan.warnings.some((warning) => warning.includes("owner approval")));
});

test("deployment plan rejects secret material and unsafe payout funding", () => {
  const base = {
    network: "SN_MAIN",
    privacyPool: "0x111",
    issuer: "0x222",
    treasury: "0x333",
    asset: "0x444",
    recipient: "0x555",
    capabilityName: "Treasury Payout",
    capabilitySymbol: "BB_PAY",
    maxAmount: 5_000n,
    expiresAt: 2_000_000_000n,
    reusable: false,
    supply: 1n,
    treasuryAllowance: 5_000n,
  };
  assert.throws(
    () => buildTreasuryDeploymentPlan({ ...base, privateKey: "never" }),
    /secret material/,
  );
  assert.throws(
    () => buildTreasuryDeploymentPlan({ ...base, treasuryAllowance: 4_999n }),
    /cover at least one maximum payout/,
  );
  assert.throws(
    () => buildTreasuryDeploymentPlan({ ...base, reusable: "false" }),
    /reusable must be a boolean/,
  );
});
