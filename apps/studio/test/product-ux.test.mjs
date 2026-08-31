import test from "node:test";
import assert from "node:assert/strict";
import { renderHome } from "../src/ui/home.mjs";
import { renderShell } from "../src/ui/shell.mjs";
import { renderMandateDetail } from "../src/ui/mandate-detail.mjs";
import { renderPassDelivery } from "../src/ui/pass-delivery.mjs";
import { renderHolder } from "../src/ui/holder.mjs";

const text = (tree) => JSON.stringify(tree);
const record = {
  state: "active", token: "0x12345678901234567890", tokenName: "Vendor mandate",
  tokenSymbol: "STRK", recipient: "0x98765432109876543210", maxFirstArg: "20000000000000000000",
  remainingBudget: "80000000000000000000", reusable: true, expiresAt: 4102444800, uses: 0,
  gatekeeper: "0x11111111111111111111", adapter: "0x22222222222222222222",
};

test("home explains the two-role treasury-to-operator journey", () => {
  const value = text(renderHome());
  assert.match(value, /Treasury creates the rule/);
  assert.match(value, /Treasury delivers one pass/);
  assert.match(value, /Operator requests payment/);
  assert.match(value, /Create a mandate/);
  assert.match(value, /Keep your treasury key/);
});

test("workspace exposes distinct treasury, creation, and operator navigation", () => {
  const value = text(renderShell({ tag: "p", attrs: {}, children: ["content"] }, { view: "home", wallet: null }));
  assert.match(value, /Treasury mandates/);
  assert.match(value, /Create mandate/);
  assert.match(value, /Use a permission/);
  assert.match(value, /Connect wallet/);
});

test("mandate detail prioritizes pass delivery before operator-link sharing", () => {
  const value = text(renderMandateDetail({ mandate: record }));
  assert.match(value, /Issue private pass/);
  assert.doesNotMatch(value, /Copy operator link/);
  assert.match(value, /The operator cannot/);
});

test("delivery screen presents the real staged Mainnet actions", () => {
  const value = text(renderPassDelivery({ mandate: record, delivery: { recipient: "0xabc" } }));
  assert.match(value, /Deliver one private permission/);
  assert.match(value, /Approve one pass/);
  assert.match(value, /Send private pass/);
  assert.doesNotMatch(value, /Pass delivered/);
});

test("operator surface asks for the wallet that received the pass", () => {
  const value = text(renderHolder({ view: "holder", wallet: null, holder: { token: "0x1", record: null, view: "input" } }));
  assert.match(value, /Connect the same compatible wallet/);
  assert.match(value, /Connect wallet/);
  assert.match(value, /Check the pass in your wallet/);
  assert.match(value, /Before you request payment/);
});
