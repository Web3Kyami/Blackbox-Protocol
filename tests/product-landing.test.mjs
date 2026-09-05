import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const homeHtml = await readFile(new URL("../apps/web/src/index.html", import.meta.url), "utf8");
const docsHtml = await readFile(new URL("../apps/web/src/docs.html", import.meta.url), "utf8");
const useCasesHtml = await readFile(new URL("../apps/web/src/use-cases.html", import.meta.url), "utf8");
const securityHtml = await readFile(new URL("../apps/web/src/security.html", import.meta.url), "utf8");
const holderHtml = await readFile(new URL("../apps/web/src/holder-app.html", import.meta.url), "utf8");
const issuerHtml = await readFile(new URL("../apps/web/src/issue.html", import.meta.url), "utf8");
const holderApp = await readFile(new URL("../apps/web/src/holder-app.mjs", import.meta.url), "utf8");
const issuerApp = await readFile(new URL("../apps/web/src/issue.mjs", import.meta.url), "utf8");
const walletOperator = await readFile(new URL("../apps/web/src/wallet-operator.mjs", import.meta.url), "utf8");
const headerApp = await readFile(new URL("../apps/web/src/header.mjs", import.meta.url), "utf8");
const overviewHtml = await readFile(new URL("../apps/web/src/docs/overview-page.html", import.meta.url), "utf8");
const integrateHtml = await readFile(new URL("../apps/web/src/docs/integrate-page.html", import.meta.url), "utf8");
const useCapabilityHtml = await readFile(new URL("../apps/web/src/docs/use-page.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");
const buildScript = await readFile(new URL("../scripts/build-web.mjs", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const networks = await readFile(new URL("../docs/NETWORKS.md", import.meta.url), "utf8");
const sprintMetadata = JSON.parse(await readFile(new URL("../strk20.json", import.meta.url), "utf8"));

test("homepage leads with a plain-language private capability product", () => {
  assert.match(homeHtml, /Public rules[.]<br><em>Private operators[.]<\/em>/);
  assert.match(homeHtml, /Give someone a narrowly defined onchain permission/);
  assert.match(homeHtml, /Pay an approved vendor/);
  assert.match(homeHtml, /0[.]01 STRK/);
  assert.match(homeHtml, /CHOOSE HOW TO START/);
  assert.match(homeHtml, /Set one exact permission/);
  assert.match(homeHtml, /\.\/app\.html/);
  assert.match(homeHtml, /href="\.\/studio\/">Create a mandate/);
  assert.match(homeHtml, /Open Studio/);
  assert.doesNotMatch(homeHtml, /AI agent leaderboard/i);
});

test("shared navigation exposes issuer, holder, builder, and mobile paths", () => {
  assert.match(headerApp, /\/use-cases[.]html/);
  assert.match(headerApp, /\/docs[.]html/);
  assert.match(headerApp, /\/security[.]html/);
  assert.match(headerApp, /\/issue[.]html/);
  assert.match(headerApp, /My capabilities/);
  assert.match(headerApp, /\/studio\//);
  assert.match(headerApp, /Open Studio/);
  assert.match(headerApp, /aria-expanded/);
  assert.match(docsHtml, /[.]\/docs\/integrate[.]html/);
});

test("separate docs, use-case, and security pages keep the homepage simple", () => {
  assert.match(docsHtml, /Direct integration/);
  assert.match(docsHtml, /Protocol overview/);
  assert.match(useCasesHtml, /Pay a pre-approved vendor/);
  assert.match(useCasesHtml, /Pause one contract/);
  assert.match(securityHtml, /Hide the operator[.]<br><em>Keep the rule visible[.]<\/em>/);
  assert.match(securityHtml, /deposit address, token, and amount/i);
  assert.match(securityHtml, /Verified Mainnet flow/);
  assert.match(securityHtml, /fixed 0[.]01 STRK payment/);
});

test("designed docs explain the protocol with current visuals and honest privacy boundaries", () => {
  assert.match(overviewHtml, /PROTOCOL MAP/);
  assert.match(overviewHtml, /shielding or deposit address, token and amount/);
  assert.match(overviewHtml, /Sender separation also depends on the wallet’s relay path/);
  assert.match(integrateHtml, /deposits publicly, then privately delivers/);
  assert.match(integrateHtml, /href="[.][.]\/issue[.]html"/);
  assert.match(useCapabilityHtml, /href="[.][.]\/app[.]html"/);
  assert.doesNotMatch(`${integrateHtml}${useCapabilityHtml}`, /<img/);
});

test("primary visitor labels and documentation remain readable", () => {
  assert.match(styles, /nav \{[^}]*font-size: 14px/);
  assert.match(styles, /[.]connection-facts span[^}]*10px/);
  assert.match(styles, /[.]connection-facts strong[^}]*12px/);
  assert.match(styles, /[.]doc-card p[^}]*font-size: 14px/);
  assert.match(styles, /[.]flow-sequence p[^}]*font-size: 14px/);
  assert.doesNotMatch(styles, /[.]connection-facts span[^}]*8px/);
});

test("production build publishes only the active product surface", () => {
  assert.doesNotMatch(buildScript, /cp\(new URL\("[.][.]\/apps\/web\/src\/"/);
  assert.doesNotMatch(buildScript, /deploy[.]html|deploy[.]mjs|deployment\/|case-study[.]json|capability-sdk[.]mjs/);
  assert.doesNotMatch(buildScript, /sourcemap: true/);
  for (const route of ["index.html", "app.html", "issue.html", "docs.html", "security.html"]) {
    assert.match(buildScript, new RegExp(route.replace(".", "[.]")));
  }
  assert.match(buildScript, /apps\/studio\/scripts\/build-preview[.]mjs/);
  assert.match(buildScript, /new URL\("studio\/", output\)/);
  assert.match(buildScript, /\["index[.]html", "app[.]mjs", "runtime-config[.]mjs", "style[.]css"\]/);
});

test("public documentation and sprint metadata reflect verified Mainnet truth", () => {
  assert.match(readme, /0x26a63750cb24beb38cc4eb8a976d04458c9015331b63be89a71c309a2b8e589/);
  assert.match(readme, /0x7978bc0e9292a86c9e01411784dd6ec3db117e967a2ec08a2131844579d1386/);
  assert.doesNotMatch(readme, /private issuance and holder exercise remain\s+`?UNVERIFIED/i);
  assert.match(networks, /SN_MAIN/);
  assert.match(networks, /strk20InvokeTransaction/);
  assert.equal(sprintMetadata.transactions.length, 2);
  assert.equal(sprintMetadata.contracts.length, 3);
  assert.equal(sprintMetadata.demo_url, "https://blackbox-arena.vercel.app");
});

test("operator console wires the privacy Wallet API and verifies relay separation", () => {
  assert.match(holderApp, /WalletAccountV6[.]connect/);
  assert.match(holderApp, /strk20InvokeTransaction/);
  assert.match(walletOperator, /relaySeparation/);
  assert.match(holderApp, /MAINNET_CHAIN_ID/);
  assert.doesNotMatch(`${walletOperator}${holderApp}`, /privateKey|viewingKey|mnemonic/);
});

test("current issuer and holder surfaces use product role labels", () => {
  for (const surface of [holderHtml, issuerHtml, holderApp, issuerApp]) {
    assert.doesNotMatch(surface, /Account A|Account B|Ready X/i);
  }
  assert.match(holderHtml, /PASS HOLDER WALLET/);
  assert.match(issuerHtml, /LIVE MAINNET POLICY/);
  assert.match(holderApp, /NO PASS AVAILABLE/);
  assert.match(holderApp, /Ask the policy issuer to send one, or switch wallets/);
  assert.doesNotMatch(holderApp, /not the pass holder for the active policy/);
});

test("public source footers expose the real project destinations", () => {
  for (const page of [homeHtml, useCasesHtml]) {
    assert.match(page, /github[.]com\/Web3Kyami\/Blackbox-Protocol/);
    assert.match(page, /x[.]com\/Web3Kyami/);
    assert.match(page, /mailto:web3kyami@gmail[.]com/);
    assert.doesNotMatch(page, /· soon/);
  }
});
