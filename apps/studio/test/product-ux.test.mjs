import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

test("wallet picker distinguishes discovery from an empty result and offers retry", () => {
  const loading = text(renderShell({ tag: "p", attrs: {}, children: ["content"] }, { view: "home", walletPicker: { open: true, loading: true, options: [] } }));
  assert.match(loading, /Checking installed wallets/);
  assert.doesNotMatch(loading, /No compatible Starknet wallet was detected/);

  const empty = text(renderShell({ tag: "p", attrs: {}, children: ["content"] }, { view: "home", walletPicker: { open: true, loading: false, options: [] } }));
  assert.match(empty, /No compatible Starknet wallet was detected/);
  assert.match(empty, /Check again/);
  assert.match(empty, /connect-wallet-request/);
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
  assert.match(value, /Share operator link/);
});

test("operator surface asks for the wallet that received the pass", () => {
  const value = text(renderHolder({ view: "holder", wallet: null, holder: { token: "0x1", record: null, view: "input" } }));
  assert.match(value, /Connect the wallet that received this permission/);
  assert.match(value, /Connect wallet/);
  assert.match(value, /Payment permission ready/);
  assert.doesNotMatch(value, /Before you request payment/);
});

test("deployment developer details cannot widen the review rail", () => {
  const stylesheet = readFileSync(fileURLToPath(new URL("../src/ui/style.css", import.meta.url)), "utf8");
  assert.match(stylesheet, /\.rail \{ min-width: 0;/);
  assert.match(stylesheet, /\.technical-details \.rail-list \{[^}]*overflow-wrap: anywhere;/s);
});

test("mobile keeps every primary navigation destination and prevents narrow-screen overflow", () => {
  const stylesheet = readFileSync(fileURLToPath(new URL("../src/ui/style.css", import.meta.url)), "utf8");
  assert.doesNotMatch(stylesheet, /\.workspace-nav__item:nth-child\(4\)\s*\{\s*display:\s*none/);
  assert.match(stylesheet, /@media \(max-width: 680px\)[\s\S]*html, body \{ overflow-x: hidden; \}/);
  assert.match(stylesheet, /@media \(max-width: 420px\)[\s\S]*\.activation-progress \{ grid-template-columns: 1fr; \}/);
});

test("preview uses one stable application module for wallet-flow recovery", () => {
  const buildScript = readFileSync(fileURLToPath(new URL("../scripts/build-preview.mjs", import.meta.url)), "utf8");
  assert.match(buildScript, /splitting:\s*false/);
  assert.doesNotMatch(buildScript, /chunkNames:\s*["']/);
});

test("the final responsive layer covers every Studio product surface", () => {
  const stylesheet = readFileSync(fileURLToPath(new URL("../src/ui/style.css", import.meta.url)), "utf8");
  assert.match(stylesheet, /Final responsive system/);
  assert.match(stylesheet, /@media \(max-width: 1100px\)[\s\S]*\.workspace-nav[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(stylesheet, /@media \(max-width: 900px\)[\s\S]*\.home-hero \{ grid-template-columns: 1fr; \}/);
  assert.match(stylesheet, /@media \(max-width: 760px\)[\s\S]*\.wizard[\s\S]*\.studio-summary[\s\S]*\.detail-grid[\s\S]*\.delivery-layout[\s\S]*\.hb-holder/);
  assert.match(stylesheet, /\.hb-holder::before \{ display: none; content: none; \}/);
});
