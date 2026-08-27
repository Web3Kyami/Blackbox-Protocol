import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appHtml = await readFile(new URL("../apps/web/src/index.html", import.meta.url), "utf8");
const homeHtml = await readFile(new URL("../apps/web/src/home.html", import.meta.url), "utf8");
const docsHtml = await readFile(new URL("../apps/web/src/docs.html", import.meta.url), "utf8");
const useCasesHtml = await readFile(new URL("../apps/web/src/use-cases.html", import.meta.url), "utf8");
const securityHtml = await readFile(new URL("../apps/web/src/security.html", import.meta.url), "utf8");
const app = await readFile(new URL("../apps/web/src/app.mjs", import.meta.url), "utf8");

test("homepage leads with a plain-language private capability product", () => {
  assert.match(homeHtml, /Public rules[.]<br><em>Private operators[.]<\/em>/);
  assert.match(homeHtml, /Give someone a narrowly defined onchain permission/);
  assert.match(homeHtml, /Pay a vendor/);
  assert.match(homeHtml, /Set one exact permission/);
  assert.match(homeHtml, /\.\/app\.html/);
  assert.doesNotMatch(homeHtml, /AI agent leaderboard/i);
});

test("separate docs, use-case, and security pages keep the homepage simple", () => {
  assert.match(docsHtml, /SDK, not a fake API/);
  assert.match(docsHtml, /Protocol overview/);
  assert.match(useCasesHtml, /Pay a pre-approved vendor/);
  assert.match(useCasesHtml, /Pause one contract/);
  assert.match(securityHtml, /Hide the operator[.]<br><em>Keep the rule visible[.]<\/em>/);
  assert.match(securityHtml, /deposit address, token, and amount/);
  assert.match(securityHtml, /UNVERIFIED/);
});

test("policy builder uses the shared capability SDK and does not sign or deploy", () => {
  assert.match(app, /buildRegisterPolicyCall/);
  assert.match(app, /describeDisclosure/);
  assert.doesNotMatch(app, /account[.]execute/);
  assert.doesNotMatch(app, /privateKey|viewingKey|mnemonic/);
  assert.match(appHtml, /will not sign or deploy without explicit owner approval/);
});

test("operator console wires the privacy Wallet API and verifies relay separation", () => {
  assert.match(appHtml, /05 \/ OPERATOR CONSOLE/);
  assert.match(appHtml, /Example addresses are blocked/);
  assert.match(appHtml, /Sender privacy is reported as verified only after/);
  assert.match(app, /WalletAccountV6[.]connect/);
  assert.match(app, /strk20PrepareInvoke/);
  assert.match(app, /strk20InvokeTransaction/);
  assert.match(app, /relaySeparation/);
  assert.match(app, /MAINNET_CHAIN_ID/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});

test("every public page exposes transparent placeholder social links", () => {
  for (const page of [homeHtml, docsHtml, useCasesHtml, securityHtml, appHtml]) {
    assert.match(page, /GitHub · soon/);
    assert.match(page, /X · soon/);
    assert.match(page, /Founder site · soon/);
    assert.match(page, /Contact · soon/);
  }
});
