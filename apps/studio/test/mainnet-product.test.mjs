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
  mainnetProvider,
  deployNext,
  approvePassDelivery,
  deliverPrivatePass,
  exerciseHolderPass,
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
  } finally {
    mainnetProvider.waitForTransaction = originalWait;
  }
});

test("invalid recipient addresses fail before a wallet approval", () => {
  assert.equal(BigInt(normalizeStarknetAddress("0x1")), 1n);
  assert.throws(() => normalizeStarknetAddress("not-a-wallet"), /valid Starknet wallet/);
  assert.throws(() => normalizeStarknetAddress("0x0"), /valid Starknet wallet/);
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
