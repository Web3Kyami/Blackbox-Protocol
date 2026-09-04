import test from "node:test";
import assert from "node:assert/strict";

import { readUiRecovery, uiRecoverySnapshot, writeUiRecovery } from "../src/ui/recovery.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("refresh recovery retains the current public workflow without wallet authority", () => {
  const storage = memoryStorage();
  const key = "studio-recovery";
  const state = {
    view: "delivery",
    step: 5,
    draft: { treasury: "0x1", recipient: "0x2", cap: "0.01", budget: "0.03" },
    acknowledgedBoundary: true,
    plan: { maxAmount: "10000000000000000" },
    mandate: { token: "0x3", recipient: "0x2", remainingBudget: "30000000000000000" },
    holder: null,
    wallet: { address: "0x1", provider: { secret: "must-not-persist" } },
    delivery: { pendingDeliveryTransaction: "0x4" },
  };

  assert.equal(writeUiRecovery(storage, key, state), true);
  const savedText = storage.getItem(key);
  assert.doesNotMatch(savedText, /must-not-persist|provider|wallet/);

  const recovered = readUiRecovery(storage, key);
  assert.equal(recovered.view, "delivery");
  assert.equal(recovered.step, 5);
  assert.deepEqual(recovered.draft, state.draft);
  assert.deepEqual(recovered.plan, state.plan);
  assert.deepEqual(recovered.mandate, state.mandate);
  assert.equal(recovered.acknowledgedBoundary, true);
});

test("holder refresh retains only the public policy identifier", () => {
  const snapshot = uiRecoverySnapshot({
    view: "holder",
    holder: {
      token: "0xabc",
      record: { recipient: "0xdef" },
      issuance: { proof: "private-proof", receipt: { txHash: "0x123" } },
    },
  });
  assert.equal(snapshot.holderToken, "0xabc");
  assert.equal(JSON.stringify(snapshot).includes("private-proof"), false);
  assert.equal(JSON.stringify(snapshot).includes("0x123"), false);
});

test("invalid or obsolete recovery data fails closed", () => {
  const storage = memoryStorage();
  storage.setItem("bad-json", "{");
  storage.setItem("wrong-version", JSON.stringify({ version: 99, view: "wizard" }));
  storage.setItem("wrong-view", JSON.stringify({ version: 1, view: "admin" }));
  assert.equal(readUiRecovery(storage, "bad-json"), null);
  assert.equal(readUiRecovery(storage, "wrong-version"), null);
  assert.equal(readUiRecovery(storage, "wrong-view"), null);
});
