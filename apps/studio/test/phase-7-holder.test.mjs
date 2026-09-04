// Phase 7 — Dynamic holder experience (tests).
//
// Evidence gate (falsifiable, no fake reads):
//   - renderHolder returns the correct banner for each of the 6 holder states.
//   - buildHolderAction produces calldata IDENTICAL to the upstream SDK's
//     buildWalletApiCapabilityActions (mutation test: changing the policy must
//     change the calldata).
//   - links and exports contain public policy identifiers only.

import test from "node:test";
import assert from "node:assert/strict";

import { renderHolder } from "../src/ui/holder.mjs";
import { holderLink, loadHolderPolicy, policyExport } from "../src/sdk/holder-reads.mjs";
import { buildHolderAction } from "../src/sdk/holder-action.mjs";
import { buildWalletApiCapabilityActions } from "../src/sdk/blackbox-capability-sdk.mjs";
import { classifyPolicy } from "../src/sdk/org-policy-indexer.mjs";
import { makeReadProvider } from "../src/sdk/studio-network.mjs";

const BBP = "0x6285daa14a51a8b8c325f30289c03927514800cec0206ecf37f3f49694870e9";
const GATEKEEPER = "0x226b161a1e762b0f15dd7e73f3fe182e0a6596e202e6307a014ace42e7b4282";
const ADAPTER = "0x278c26f08c026e3086fe5690a5efc800b87e05e872fde67c26eb245ac269375";
const MAINNET_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Build a normalized record (Phase 5/7 shape) from a raw policy for offline tests.
// Uses a far-future expiresAt so the SDK's validatePolicy accepts it (the
// SDK validates positive u64s; live reads assert the real chain value.
function fakeRecord(policyOverride = {}) {
  return {
    state: "active",
    token: BBP,
    gatekeeper: GATEKEEPER,
    adapter: ADAPTER,
    asset: MAINNET_STRK,
    policy: {
      issuer: "0x4ff92744c1ed2927e7c3a97cf14b84b197868df7a3486677a8fa8c8974aa6c8",
      target: ADAPTER,
      selector: "147175034569853289224521560839224189782247190155059259541478718796273078102",
      enforceFirstArgMax: true,
      maxFirstArg: "2", // synthetic fixture; live policy assertion below is "1"
      expiresAt: "4102444800", // 2100-01-01, never-expired for the SDK
      reusable: false,
      active: true,
      uses: 0,
    },
    ...policyOverride,
  };
}

function walk(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (!node || typeof node === "string") return out;
  out.push(node);
  for (const child of node.children || []) walk(child, out);
  return out;
}

test("every operator control is connected to a browser event", () => {
  const states = [
    { view: "holder", holder: { token: "", record: null, view: "input" } },
    { view: "holder", wallet: { address: "0x1" }, holder: { token: BBP, record: null, view: "input" } },
    { view: "holder", wallet: { address: "0x1" }, holder: { token: BBP, record: fakeRecord(), view: "loaded", permissionChecked: true, issuance: { fields: { amount: "1" } } } },
    { view: "holder", holder: { token: BBP, record: null, view: "no-pass", error: "No pass" } },
  ];
  for (const state of states) {
    for (const node of walk(renderHolder(state))) {
      const action = node.attrs?.["data-action"];
      if (!action) continue;
      const handler = node.tag === "input" ? node.attrs.oninput : node.attrs.onclick;
      assert.equal(handler?.type, action, `${action} must have a matching ${node.tag === "input" ? "input" : "click"} handler`);
    }
  }
});

test("renderHolder shows the token input when no record is loaded", () => {
  const tree = renderHolder({ view: "holder", holder: { token: "", record: null, view: "input" } });
  const html = JSON.stringify(tree);
  assert.match(html, /Request an approved payment/);
  assert.match(html, /Connect wallet/);
  assert.match(html, /Back/);
  assert.match(JSON.stringify(renderHolder({ view: "holder", holder: { token: BBP, record: null, view: "checking" } })), /Checking your permission/);
  assert.match(JSON.stringify(renderHolder({ view: "holder", holder: { token: BBP, record: null, view: "error", error: "RPC timeout" } })), /RPC timeout/);
  const complete = renderHolder({
    view: "holder",
    holder: {
      token: BBP,
      record: fakeRecord(),
      view: "complete", permissionChecked: true,
      issuance: { fields: { amount: "1" }, receipt: { kind: "real", txHash: "0x123" } },
    },
  });
  const completeHtml = JSON.stringify(complete);
  assert.match(completeHtml, /PAYMENT CONFIRMED/);
  assert.match(completeHtml, /confirmed on Mainnet/);
  assert.match(completeHtml, /Remaining treasury allowance/);
  assert.match(completeHtml, /https:\/\/voyager\.online\/tx\/0x123/);
  assert.doesNotMatch(completeHtml, /Request payment/);

  const delayedRead = renderHolder({
    view: "holder",
    holder: {
      token: BBP,
      record: fakeRecord({ postPaymentStateVerified: false }),
      view: "complete", permissionChecked: true,
      issuance: { fields: { amount: "1" }, receipt: { kind: "real", txHash: "0x456" } },
    },
  });
  const delayedReadHtml = JSON.stringify(delayedRead);
  assert.match(delayedReadHtml, /PAYMENT CONFIRMED/);
  assert.match(delayedReadHtml, /https:\/\/voyager\.online\/tx\/0x456/);
  assert.doesNotMatch(delayedReadHtml, /Remaining treasury allowance/);
  assert.doesNotMatch(delayedReadHtml, /Request payment/);
});

test("renderHolder only claims public policy states", () => {
  const states = ["active", "expired", "revoked"];
  for (const st of states) {
    const rec = fakeRecord({ state: st });
    const tree = renderHolder({ view: "holder", wallet: { address: "0x1" }, holder: { record: rec, view: "loaded", permissionChecked: true } });
    const html = JSON.stringify(tree);
    // Each state must render its distinct banner copy.
    const expect = {
      active: "Policy is active",
      expired: "Expired",
      revoked: "Revoked",
    }[st];
    assert.match(html, new RegExp(expect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderHolder only shows the request panel when the public policy is active", () => {
  const ready = JSON.stringify(renderHolder({ view: "holder", wallet: { address: "0x1" }, holder: { record: fakeRecord({ state: "active" }), view: "loaded", permissionChecked: true } }));
  const expired = JSON.stringify(renderHolder({ view: "holder", wallet: { address: "0x1" }, holder: { record: fakeRecord({ state: "expired" }), view: "loaded", permissionChecked: true } }));
  assert.match(ready, /Request the approved payment/);
  assert.doesNotMatch(expired, /Request the approved payment/);
});

test("payment editing uses a stable decimal field and keeps validation inline", () => {
  const state = {
    view: "holder",
    wallet: { address: "0x1" },
    holder: {
      record: fakeRecord({ state: "active" }),
      view: "loaded",
      permissionChecked: true,
      issuance: { fields: { amount: "0.005" }, error: "Enter an amount greater than zero." },
    },
  };
  const value = JSON.stringify(renderHolder(state));
  assert.match(value, /holder-payment-amount/);
  assert.match(value, /inputmode.*decimal/);
  assert.match(value, /0\.005/);
  assert.match(value, /Enter an amount greater than zero/);
  assert.doesNotMatch(value, /Could not continue/);
});

test("classifyPolicy treats expiresAt=0 as never-expiring", () => {
  const now = Date.now();
  assert.equal(classifyPolicy({ policy: { active: true, expiresAt: 0 } }, now), "active");
  assert.equal(classifyPolicy({ policy: { active: false, expiresAt: 0 } }, now), "revoked");
});

test("buildHolderAction calldata equals the upstream SDK byte-for-byte (mutation)", () => {
  const rec = fakeRecord();
  const targetCalldata = ["0x1"];
  const studioAction = buildHolderAction(rec, targetCalldata);

  // Direct call to the upstream SDK with the same inputs must match exactly.
  // buildHolderAction forwards the policy as-is, so the SDK normalizes it
  // the same way on both paths.
  const rawPolicy = {
    gatekeeper: rec.gatekeeper,
    capabilityToken: rec.token,
    target: rec.policy.target,
    selector: rec.policy.selector,
    enforceFirstArgMax: rec.policy.enforceFirstArgMax,
    maxFirstArg: rec.policy.maxFirstArg,
    expiresAt: rec.policy.expiresAt,
    reusable: rec.policy.reusable,
    active: rec.policy.active,
  };
  const sdkAction = buildWalletApiCapabilityActions({ policy: rawPolicy, targetCalldata, holderAddress: null });

  assert.deepEqual(studioAction, sdkAction, "studio must forward the exact SDK action, no invented calldata");

  // Mutation test: a different first-arg must change the calldata.
  const mutated = buildHolderAction(rec, ["0x2"]);
  assert.notDeepEqual(mutated, sdkAction, "changing the exercise amount must change the action calldata");
});

test("holder links use the documented public policy identifier and exports exclude private state", () => {
  const link = holderLink(BBP);
  assert.equal(link, `?policy=${BBP}`);
  const exported = policyExport({
    ...fakeRecord(), recipient: "0x123", maxFirstArg: "1", expiresAt: 4102444800,
  });
  assert.equal(exported.token, BBP);
  assert.equal(exported.holderLink, link);
  assert.equal(JSON.stringify(exported).match(/note|proof|viewing|private/i), null);
});

test("Mainnet reads fall back when the primary RPC is unavailable", async () => {
  const attempts = [];
  const provider = makeReadProvider(["primary", "fallback"], (name) => ({
    async callContract(request) {
      attempts.push([name, request]);
      if (name === "primary") throw new Error("temporary RPC failure");
      return ["0x1"];
    },
  }));
  assert.deepEqual(await provider.callContract({ contractAddress: "0x1" }), ["0x1"]);
  assert.deepEqual(attempts.map(([name]) => name), ["primary", "fallback"]);
});

test("holder links resolve their own contracts and ignore unrelated runtime defaults", async () => {
  const token = "0x101";
  const gatekeeper = "0x202";
  const adapter = "0x303";
  const asset = "0x404";
  const issuer = "0x505";
  const recipient = "0x606";
  const provider = {
    async callContract({ contractAddress, entrypoint }) {
      if (contractAddress === token) {
        if (entrypoint === "name") return ["0x424258"];
        if (entrypoint === "symbol") return ["0x42425853"];
        if (entrypoint === "total_supply") return ["0x1", "0x0"];
        if (entrypoint === "get_issuer") return [issuer];
        if (entrypoint === "get_privacy_pool") return ["0x707"];
        if (entrypoint === "get_gatekeeper") return [gatekeeper];
      }
      if (contractAddress === gatekeeper && entrypoint === "get_policy") {
        return [issuer, adapter, "0x1", "0x1", "0x2386f26fc10000", "0x77359400", "0x1", "0x1", "0x0"];
      }
      if (contractAddress === adapter) {
        if (entrypoint === "get_config") return [gatekeeper, issuer, asset, recipient];
        if (entrypoint === "get_total_spent") return ["0x0", "0x0"];
      }
      if (contractAddress === asset && entrypoint === "allowance") return ["0x6a94d74f430000", "0x0"];
      throw new Error(`unexpected read ${contractAddress}.${entrypoint}`);
    },
  };

  const record = await loadHolderPolicy(token, {
    provider,
    gatekeeper: "0xdead",
    adapter: "0xbeef",
    asset: "0xbad",
  });
  assert.equal(record.gatekeeper, gatekeeper);
  assert.equal(record.adapter, adapter);
  assert.equal(record.asset, asset);
  assert.equal(record.state, "active");
});
