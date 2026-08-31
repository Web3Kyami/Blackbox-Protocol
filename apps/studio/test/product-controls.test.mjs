import test from "node:test";
import assert from "node:assert/strict";
import { renderHome } from "../src/ui/home.mjs";
import { renderShell } from "../src/ui/shell.mjs";
import { renderWizard, initialState } from "../src/ui/wizard.mjs";
import { renderDashboard } from "../src/ui/dashboard.mjs";
import { renderMandateDetail } from "../src/ui/mandate-detail.mjs";
import { renderPassDelivery } from "../src/ui/pass-delivery.mjs";
import { renderHolder } from "../src/ui/holder.mjs";

const record = {
  state: "active", token: "0x123", tokenName: "Treasury Permission", tokenSymbol: "STRK",
  recipient: "0x456", maxFirstArg: "10000000000000000", remainingBudget: "30000000000000000",
  reusable: true, expiresAt: 4102444800, uses: 0, gatekeeper: "0x789", adapter: "0xabc",
  treasury: "0x1", asset: "0x2", links: {}, deliveryTransaction: "0x777",
  policy: { maxFirstArg: "10000000000000000", reusable: true, expiresAt: 4102444800 },
};

function walk(node, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, output);
    return output;
  }
  if (!node || typeof node === "string") return output;
  output.push(node);
  for (const child of node.children || []) walk(child, output);
  return output;
}

test("every visible product control has a real browser handler", () => {
  const validDraft = { treasury: "0x1", recipient: "0x456", cap: "0.01", budget: "0.03", supply: "1", mode: "reusable", expiry: "2099-01-01" };
  const trees = [
    renderHome(),
    renderShell(renderHome(), { view: "home", walletPicker: { open: true, options: [{ name: "Wallet" }] } }),
    ...[0, 1, 2, 4, 5].map((step) => renderWizard({ ...initialState({ draft: validDraft, wallet: { address: "0x1" } }), step })),
    renderDashboard({ org: "0x1", index: { count: 1, byState: { active: 1 }, records: [record] } }),
    renderMandateDetail({ mandate: record, dashboard: {} }),
    renderPassDelivery({ mandate: record, wallet: { address: "0x1" }, delivery: { recipient: "0x999", approvalBlock: 1 } }),
    renderHolder({ wallet: { address: "0x999" }, holder: { token: "0x123", record, permissionChecked: true, view: "loaded", issuance: { fields: { amount: "0.01" } } } }),
  ];

  for (const tree of trees) {
    for (const node of walk(tree)) {
      if (node.tag === "button" && !node.attrs?.disabled) {
        assert.ok(node.attrs?.onclick?.type, `button "${JSON.stringify(node.children)}" has no click handler`);
      }
      if (["input", "select"].includes(node.tag) && !node.attrs?.readonly && !node.attrs?.disabled) {
        assert.ok(node.attrs?.oninput?.type || node.attrs?.onchange?.type, `${node.tag} ${node.attrs?.name || node.attrs?.["data-action"] || "field"} has no input handler`);
      }
    }
  }
});
