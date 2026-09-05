// Dashboard render tests. These do not use the network.
//
// Verifies the dashboard render layer:
//   - never invents rows (empty state when count === 0)
//   - shows REAL org-owned data only
//   - renders lifecycle states, budget/uses/expiry, addresses, receipts,
//     explorer links, and public-data actions (export/share)
//   - never presents policy registration as private-pass issuance or a
//     revocation control that the deployed integration cannot perform
//
// This test does NOT touch the network. It feeds synthetic-but-shaped index
// records (matching the output of org-policy-indexer.mjs) into renderDashboard
// and asserts the tree shape. The real-on-chain assertion lives in

import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboard, STATE_LABEL } from "../src/ui/dashboard.mjs";
import { remainingBudgetFromAllowance } from "../src/sdk/policy-reads.mjs";
import { CAPABILITY_TOKEN_CLASS_HASH, tokensFromUdcEvents } from "../src/sdk/org-policy-indexer.mjs";

const ORG = "0x4ff92744c1ed2927e7c3a97cf14b84b197868df7a3486677a8fa8c8974aa6c8";

function makeRecord(over = {}) {
  return {
    state: "active",
    token: "0x6285daa14a51a8b8c325f30289c03927514800cec0206ecf37f3f49694870e9",
    gatekeeper: "0x226b161a1e762b0f15dd7e73f3fe182e0a6596e202e6307a014ace42e7b4282",
    adapter: "0x278c26f08c026e3086fe5690a5efc800b87e05e872fde67c26eb245ac269375",
    asset: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    issuer: ORG,
    target: "0x0",
    selector: "0x13c",
    enforceFirstArgMax: true,
    maxFirstArg: "1000000000000000000",
    expiresAt: 9999999999,
    reusable: true,
    active: true,
    uses: 0,
    tokenSymbol: "BBP",
    tokenName: "Trust Mandate",
    tokenTotalSupply: "10",
    treasury: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    recipient: "0x0",
    totalSpent: "0",
    allowance: "5000000000000000000",
    remainingBudget: "5000000000000000000",
    links: {
      token: "https://voyager.online/token/0x6285daa14a51a8b8c325f30289c03927514800cec0206ecf37f3f49694870e9",
      gatekeeper: "https://voyager.online/contract/0x226b161a1e762b0f15dd7e73f3fe182e0a6596e202e6307a014ace42e7b4282",
      adapter: "https://voyager.online/contract/0x278c26f08c026e3086fe5690a5efc800b87e05e872fde67c26eb245ac269375",
      registerTx: null,
    },
    actions: { export: true, issue: true, share: true, revoke: true },
    ...over,
  };
}

// Walk a tree collecting a flat list of [tag, attrs, children] nodes.
function walk(node, out = []) {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function findByAttr(nodes, key, value) {
  return nodes.filter((n) => n.attrs && n.attrs[key] === value);
}

test("empty state: no connected wallet → no fabricated rows", () => {
  const tree = renderDashboard({ org: null, index: null, loading: false, error: null });
  const all = walk(tree);
  assert.equal(tree.tag, "section", "root must be a section");
  // No policy cards present (a card has data-token).
  const cards = findByAttr(all, "data-testid", "studio-policy-card");
  assert.equal(cards.length, 0, "empty state must render zero policy cards");
});

test("empty state: connected org with 0 policies → empty CTA, no mock rows", () => {
  const tree = renderDashboard({
    org: ORG,
    index: { count: 0, byState: { active: 0, expired: 0, revoked: 0, draft: 0 }, records: [] },
    loading: false,
    error: null,
  });
  const all = walk(tree);
  const cards = findByAttr(all, "data-testid", "studio-policy-card");
  assert.equal(cards.length, 0, "must never show sample/mock rows when count === 0");
  // Empty-state CTA exists.
  const cta = all.find(
    (n) => n.tag === "button" && n.attrs && n.attrs.onclick && n.attrs.onclick.type === "dashboard-new-mandate",
  );
  assert.ok(cta, "empty state must offer a 'Create a Treasury Mandate' CTA");
});

test("loaded state: renders one card per real record with required fields", () => {
  const rec = makeRecord();
  const tree = renderDashboard({
    org: ORG,
    index: { count: 1, byState: { active: 1, expired: 0, revoked: 0, draft: 0 }, records: [rec] },
    loading: false,
    error: null,
  });
  const all = walk(tree);
  const cards = findByAttr(all, "data-testid", "studio-policy-card");
  assert.equal(cards.length, 1, "one card per record");
  // Summary bar shows total = 1.
  const summary = all.find((n) => n.attrs && n.attrs.class && n.attrs.class.includes("studio-summary"));
  assert.ok(summary, "summary bar must render");
  // Explorer link present and points to the Mainnet Voyager explorer.
  const link = all.find(
    (n) => n.tag === "a" && n.attrs && typeof n.attrs.href === "string" && n.attrs.href.includes("voyager.online"),
  );
  assert.ok(link, "dashboard must surface real explorer links");
  assert.ok(!link.attrs.href.startsWith("#"), "explorer link must not be a placeholder '#'");
  // State chip uses the exported label.
  const chip = all.find(
    (n) => n.tag === "span" && n.attrs && n.attrs.class && n.attrs.class.includes("studio-chip--active"),
  );
  assert.ok(chip, "active state chip must render");
  assert.equal(chip.children[0], STATE_LABEL.active);
});

test("dashboard keeps technical export out of cards and shares only after delivery", () => {
  const rec = makeRecord({ state: "active", active: true, deliveryTransaction: "0x123", actions: { export: true, issue: true, share: true, revoke: true } });
  const tree = renderDashboard({
    org: ORG,
    index: { count: 1, byState: { active: 1, expired: 0, revoked: 0, draft: 0 }, records: [rec] },
    loading: false,
    error: null,
  });
  const all = walk(tree);
  const issueBtns = all.filter(
    (n) => n.tag === "button" && n.attrs && n.attrs["data-action"] === "issue",
  );
  const revokeBtns = all.filter(
    (n) => n.tag === "button" && n.attrs && n.attrs["data-action"] === "revoke",
  );
  assert.equal(issueBtns.length, 0, "policy registration must not be presented as pass issuance");
  assert.equal(revokeBtns.length, 0, "no unverified revocation control may be presented");
  const shareBtns = all.filter(
    (n) => n.tag === "button" && n.attrs && n.attrs["data-action"] === "share",
  );
  assert.equal(shareBtns.length, 1, "a delivered pass exposes its operator link");
  assert.equal(all.filter((n) => n.tag === "button" && n.attrs?.["data-action"] === "export").length, 0);
});

test("error state renders the error message (no partial mock data)", () => {
  const tree = renderDashboard({
    org: ORG,
    index: null,
    loading: false,
    error: "RPC timeout",
  });
  const all = walk(tree);
  const cards = findByAttr(all, "data-testid", "studio-policy-card");
  assert.equal(cards.length, 0, "error state must not show rows");
  const text = JSON.stringify(all);
  assert.ok(text.includes("RPC timeout"), "error message must be surfaced");
});

test("loading state renders a loading status, no rows", () => {
  const tree = renderDashboard({ org: ORG, index: null, loading: true, error: null });
  const all = walk(tree);
  const cards = findByAttr(all, "data-testid", "studio-policy-card");
  assert.equal(cards.length, 0, "loading state must not show rows prematurely");
});

test("successive payments use the reduced ERC-20 allowance as remaining budget", () => {
  const payment = 1_000_000_000_000_000_000n;
  const initialAllowance = 3n * payment;

  assert.equal(remainingBudgetFromAllowance(initialAllowance), (3n * payment).toString());
  assert.equal(
    remainingBudgetFromAllowance(initialAllowance - payment),
    (2n * payment).toString(),
    "the first payment must reduce the displayed budget once, not twice",
  );
  assert.equal(
    remainingBudgetFromAllowance(initialAllowance - 2n * payment),
    payment.toString(),
    "the final valid payment must remain available after two successful payments",
  );
  assert.equal(remainingBudgetFromAllowance(0n), "0");
});

test("Studio mandates are discovered from treasury-owned UDC deployments", () => {
  const token = "0xabc";
  const otherToken = "0xdef";
  const events = [
    { data: [token, ORG, "0x1", CAPABILITY_TOKEN_CLASS_HASH] },
    { data: [token, ORG, "0x1", CAPABILITY_TOKEN_CLASS_HASH] },
    { data: [otherToken, "0x999", "0x1", CAPABILITY_TOKEN_CLASS_HASH] },
    { data: ["0x123", ORG, "0x1", "0x456"] },
  ];
  assert.deepEqual(tokensFromUdcEvents(events, ORG), [token]);
});
