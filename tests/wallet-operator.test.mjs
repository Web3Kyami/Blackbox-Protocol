import test from "node:test";
import assert from "node:assert/strict";

import {
  MAINNET_CHAIN_ID,
  actionFingerprint,
  isExamplePolicy,
  parseTargetCalldata,
  relaySeparation,
  requirePrivacyWalletFeature,
  walletErrorMessage,
} from "../apps/web/src/wallet-operator.mjs";

test("wallet feature detection fails closed", () => {
  const wallet = {
    features: { "starknet:walletApi": { request() {} } },
  };
  assert.equal(requirePrivacyWalletFeature(wallet), wallet);
  assert.throws(() => requirePrivacyWalletFeature({ features: {} }), /does not expose/);
});

test("operator calldata accepts decimal and hex felts without empty items", () => {
  assert.deepEqual(parseTargetCalldata("5000, 0xabc"), [5000n, 0xabcn]);
  assert.deepEqual(parseTargetCalldata(""), []);
  assert.throws(() => parseTargetCalldata("1, , 2"), /item 2 is empty/);
  assert.throws(() => parseTargetCalldata("amount"), /not an integer or felt/);
});

test("prepared action fingerprints change when authority input changes", () => {
  const actions = [{ type: "withdraw", token: "0x1", amount: "0x1" }];
  assert.equal(actionFingerprint(actions), actionFingerprint(structuredClone(actions)));
  assert.notEqual(
    actionFingerprint(actions),
    actionFingerprint([{ ...actions[0], token: "0x2" }]),
  );
});

test("relay separation compares normalized Starknet addresses", () => {
  assert.equal(MAINNET_CHAIN_ID, "0x534e5f4d41494e");
  assert.equal(
    relaySeparation({ holderAddress: "0x01", senderAddress: "0x2" }).verified,
    true,
  );
  assert.equal(
    relaySeparation({ holderAddress: "0x01", senderAddress: "0x1" }).verified,
    false,
  );
  assert.equal(
    relaySeparation({ holderAddress: "bad", senderAddress: "0x2" }).verified,
    false,
  );
});

test("example policies and wallet failures are labeled honestly", () => {
  assert.equal(isExamplePolicy({ gatekeeper: "0x100" }), true);
  assert.equal(
    isExamplePolicy({
      gatekeeper: "0x111",
      capabilityToken: "0x222",
      target: "0x333",
      selector: "0x444",
    }),
    false,
  );
  assert.match(walletErrorMessage(new Error("User rejected request")), /rejected/);
  assert.match(walletErrorMessage(new Error("insufficient note balance")), /private capability/);
});
