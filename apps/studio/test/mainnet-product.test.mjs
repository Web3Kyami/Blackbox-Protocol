import test from "node:test";
import assert from "node:assert/strict";
import {
  MAINNET_CHAIN_ID,
  MAINNET_CLASSES,
  deploymentKey,
  deploymentStage,
  normalizeStarknetAddress,
  strkToAtomic,
  atomicToStrk,
  validateHolderAmount,
  mainnetProvider,
  deployNext,
  approvePassDelivery,
  deliverPrivatePass,
  exerciseHolderPass,
  deliveryApprovalStatus,
  deliveryTransactionFromEvents,
} from "../src/sdk/mainnet-actions.mjs";
import { renderHolder } from "../src/ui/holder.mjs";

test("Studio is pinned to verified Mainnet classes", () => {
  assert.equal(MAINNET_CHAIN_ID, "0x534e5f4d41494e");
  assert.match(MAINNET_CLASSES.CapabilityGatekeeper, /^0x[0-9a-f]+$/);
  assert.match(MAINNET_CLASSES.CapabilityToken, /^0x[0-9a-f]+$/);
  assert.match(MAINNET_CLASSES.TreasurySpendAdapter, /^0x[0-9a-f]+$/);
});

test("STRK amounts use exact 18-decimal integer conversion", () => {
  assert.equal(strkToAtomic("0.01"), 10_000_000_000_000_000n);
  assert.equal(strkToAtomic("20"), 20_000_000_000_000_000_000n);
  assert.equal(atomicToStrk(strkToAtomic("0.01")), "0.01");
  assert.throws(() => strkToAtomic("0.0000000000000000001"));
});

test("holder amounts accept smaller payments and reject invalid values before the wallet", () => {
  const record = {
    maxFirstArg: strkToAtomic("0.01").toString(),
    remainingBudget: strkToAtomic("0.03").toString(),
  };
  assert.equal(validateHolderAmount("0.005", record), strkToAtomic("0.005"));
  assert.equal(validateHolderAmount("0.01", record), strkToAtomic("0.01"));
  assert.throws(() => validateHolderAmount("", record), /valid STRK amount/);
  assert.throws(() => validateHolderAmount("0", record), /greater than zero/);
  assert.throws(() => validateHolderAmount("0.02", record), /per-payment maximum/);
});

test("deployment resumes one confirmed stage at a time", () => {
  assert.equal(deploymentStage({}), "gatekeeper");
  assert.equal(deploymentStage({ gatekeeper: "0x1" }), "adapter");
  assert.equal(deploymentStage({ gatekeeper: "0x1", adapter: "0x2" }), "token");
  assert.equal(deploymentStage({ gatekeeper: "0x1", adapter: "0x2", token: "0x3" }), "setup");
  assert.equal(deploymentStage({ gatekeeper: "0x1", adapter: "0x2", token: "0x3", setupTransaction: "0x4" }), "complete");
});

test("a saved deployment is bound to its mandate inputs", () => {
  const draft = { treasury: "0x1", recipient: "0x2", asset: "STRK", cap: "1", budget: "3", supply: "1", mode: "reusable", expiry: "2030-01-01" };
  assert.equal(deploymentKey(draft), deploymentKey({ ...draft }));
  assert.notEqual(deploymentKey(draft), deploymentKey({ ...draft, recipient: "0x3" }));
});

test("pending hashes resume receipt checks without submitting duplicate actions", async () => {
  const originalWait = mainnetProvider.waitForTransaction;
  mainnetProvider.waitForTransaction = async (hash) => ({
    isSuccess: () => true,
    block_number: 77,
    transaction_hash: hash,
  });
  const neverSubmit = {
    deploy: async () => { throw new Error("duplicate deploy"); },
    execute: async () => { throw new Error("duplicate execute"); },
    strk20InvokeTransaction: async () => { throw new Error("duplicate private invoke"); },
  };
  try {
    const draft = { treasury: "0x1", recipient: "0x2", asset: "STRK", cap: "1", budget: "3", supply: "1", mode: "reusable", expiry: "2030-01-01" };
    const plan = { capabilityName: "Pass", capabilitySymbol: "PASS", maxAmount: "1", expiresAt: "2000000000", supply: "1", treasuryAllowance: "3" };
    const deployment = await deployNext(neverSubmit, draft, plan, {
      draftKey: deploymentKey(draft), gatekeeper: "0x3",
      pendingStage: "gatekeeper", pendingTransaction: "0xaaa",
    });
    assert.equal(deployment.gatekeeperTransaction, "0xaaa");
    assert.equal(deployment.pendingTransaction, undefined);

    assert.equal((await approvePassDelivery(neverSubmit, "0x3", 1n, { pendingApprovalTransaction: "0xbbb", fee: "6" })).transactionHash, "0xbbb");
    assert.equal((await deliverPrivatePass(neverSubmit, "0x3", "0x2", 1, 1n, { pendingDeliveryTransaction: "0xccc" })).transactionHash, "0xccc");
    assert.equal((await exerciseHolderPass(neverSubmit, [], { pendingTransaction: "0xddd" })).transactionHash, "0xddd");
    assert.equal((await exerciseHolderPass(neverSubmit, [], { completedTransaction: "0xeee" })).transactionHash, "0xeee");
  } finally {
    mainnetProvider.waitForTransaction = originalWait;
  }
});

test("a rejected pending payment fails without submitting a replacement", async () => {
  const originalWait = mainnetProvider.waitForTransaction;
  mainnetProvider.waitForTransaction = async () => ({ isSuccess: () => false });
  let submissions = 0;
  const account = {
    strk20InvokeTransaction: async () => {
      submissions += 1;
      return { transaction_hash: "0xnew" };
    },
  };
  try {
    await assert.rejects(
      exerciseHolderPass(account, [], { pendingTransaction: "0xfailed" }),
      /was not successful/,
    );
    assert.equal(submissions, 0, "recovery must not replace a rejected transaction automatically");
  } finally {
    mainnetProvider.waitForTransaction = originalWait;
  }
});

test("invalid recipient addresses fail before a wallet approval", () => {
  assert.equal(BigInt(normalizeStarknetAddress("0x1")), 1n);
  assert.throws(() => normalizeStarknetAddress("not-a-wallet"), /valid Starknet wallet/);
  assert.throws(() => normalizeStarknetAddress("0x0"), /valid Starknet wallet/);
});

test("delivery approval recovers from current onchain allowances", async () => {
  const provider = {
    getBlockNumber: async () => 123,
    callContract: async ({ contractAddress, entrypoint }) => {
      if (entrypoint === "get_fee_amount") return ["0x6"];
      if (entrypoint === "allowance") {
        return contractAddress === "0xabc" ? ["0x1", "0x0"] : ["0x6", "0x0"];
      }
      throw new Error("unexpected call");
    },
  };
  const status = await deliveryApprovalStatus("0x1", "0xabc", provider);
  assert.equal(status.approved, true);
  assert.equal(status.fee, "6");
  assert.equal(status.observedAtBlock, 123);
});

test("a successful public deposit identifies an already delivered private pass", () => {
  const owner = "0x1";
  const events = [
    { keys: ["0xtransfer", "0x0", owner], data: ["0x1", "0x0"], transaction_hash: "0xmint" },
    { keys: ["0xtransfer", owner, "0x2"], data: ["0x1", "0x0"], transaction_hash: "0xother" },
    { keys: ["0xtransfer", owner, "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"], data: ["0x1", "0x0"], transaction_hash: "0xdelivery" },
  ];
  assert.equal(deliveryTransactionFromEvents(events, owner), "0xdelivery");
});

test("operator policy details stay hidden before wallet proof", () => {
  const tree = renderHolder({
    wallet: { address: "0x999" },
    holder: { token: "0x123", record: { token: "0x123", recipient: "0x456", maxFirstArg: "10000000000000000", state: "active" }, view: "loaded", permissionChecked: false },
  });
  const value = JSON.stringify(tree);
  assert.doesNotMatch(value, /0x456/);
  assert.doesNotMatch(value, /Maximum per request/);
  assert.match(value, /Check my permission/);
});
