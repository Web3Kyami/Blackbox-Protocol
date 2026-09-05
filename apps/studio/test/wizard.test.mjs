// Studio wizard tests.
// All tests exercise the pure render layer in src/ui/wizard.mjs.
// No DOM, no jsdom, no browser. If these pass, the wizard structure
// is correct; the actual visual rendering is verified separately by
// opening the page in a real browser.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  renderWizard,
  reduce,
  initialState,
  blankDraft,
  STEPS,
  computePlan,
  publicConfiguration,
  calldataExport,
  findByTestId,
  countWhere,
  listTestIds,
} from "../src/ui/wizard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, "..");
const TEST_NETWORK_CONFIG = {
  privacyPool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  asset: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
};

// Helper: extract the text from a button node produced by the wizard
// tree. The wizard wraps leaf text in {tag:"#text", children:[str]},
// so we recurse.
function getButtonText(btnNode) {
  if (!btnNode || !btnNode.children) return "";
  const parts = [];
  for (const c of btnNode.children) {
    if (typeof c === "string") parts.push(c);
    else parts.push(getButtonText(c));
  }
  return parts.join("");
}

// ---- 1. The wizard skeleton has all six configured steps from USER_FLOW.md.
test("wizard exposes the six configured USER_FLOW.md steps in order", () => {
  assert.equal(STEPS.length, 6);
  assert.deepEqual(
    STEPS.map((s) => s.id),
    ["treasury", "limits", "behavior", "operator", "privacy-review", "deployment-review"],
  );
});

// ---- 2. The initial render has the stepper and the first-step form. ------
test("initial render contains a stepper, the treasury form, and the review rail", () => {
  const state = initialState();
  const tree = renderWizard(state);
  const wizard = findByTestId(tree, "wizard");
  assert.ok(wizard, "wizard root must be present");

  const stepper = findByTestId(tree, "stepper");
  assert.ok(stepper, "stepper must be present");
  assert.equal(stepper.tag, "ol", "stepper is an ordered list");

  // The treasury form for step 0.
  const treasuryForm = findByTestId(tree, "form-treasury");
  assert.ok(treasuryForm, "treasury form is rendered for step 0");

  // Stepper is not yet showing the review or operator forms.
  assert.equal(findByTestId(tree, "form-privacy-review"), null);
  assert.equal(findByTestId(tree, "form-deployment-review"), null);
  assert.equal(findByTestId(tree, "form-operator"), null);

  // The review rail is always rendered (it is a sticky rail).
  const rail = findByTestId(tree, "review-rail");
  assert.ok(rail, "review rail is always present");
});

// ---- 3. Each step renders a unique form testid. --------------------------
test("every step renders its own form with a unique data-testid", () => {
  for (let i = 0; i < STEPS.length; i++) {
    const state = { ...initialState(), step: i };
    const tree = renderWizard(state);
    const form = findByTestId(tree, `form-${STEPS[i].id}`);
    assert.ok(form, `step ${i} (${STEPS[i].id}) must render a form`);
  }
});

// ---- 4. The active step is highlighted in the stepper. -------------------
test("the stepper marks the current step as active", () => {
  const state = { ...initialState(), step: 2 };
  const tree = renderWizard(state);
  const stepper = findByTestId(tree, "stepper");
  // Walk children to find the one with the active class.
  const active = stepper.children.find(
    (c) => c && c.tag === "li" && c.attrs?.class?.includes("stepper-item--active"),
  );
  assert.ok(active, "exactly one stepper item is active");
  assert.equal(active.attrs["data-step-id"], "behavior");
});

test("visible wizard navigation omits the redundant roles stop and stays sequential", () => {
  const tree = renderWizard({ ...initialState(), step: 4 });
  const stepper = findByTestId(tree, "stepper");
  const serialized = JSON.stringify(stepper);
  assert.doesNotMatch(serialized, /Roles & delivery/);
  assert.match(serialized, /Privacy review/);
  assert.match(serialized, /Deployment review/);
  assert.deepEqual(
    stepper.children.map((item) => item.children[0].children[0].children[0].children[0]),
    ["1", "2", "3", "4", "5"],
  );
});

// ---- 5. Reduce: next/back moves the step. --------------------------------
test("reduce next moves the step forward and clamps at the last step", () => {
  const s0 = initialState();
  // From step 0, five `next` events take us to step 5 (the last step).
  // A sixth `next` is a no-op (clamped at STEPS.length - 1).
  const s5 = reduce(reduce(reduce(reduce(reduce(s0, { type: "next" }), { type: "next" }), { type: "next" }), { type: "next" }), { type: "next" });
  assert.equal(s5.step, 5, "five nexts from step 0 land on the last step");
  const sBeyond = reduce(s5, { type: "next" });
  assert.equal(sBeyond.step, 5, "next clamps at the last step");
  const sBack = reduce(sBeyond, { type: "back" });
  assert.equal(sBack.step, 4);
  const sFloor = reduce(initialState(), { type: "back" });
  assert.equal(sFloor.step, 0, "back clamps at step 0");
});

test("completed step labels navigate backward but never skip forward", () => {
  const state = { ...initialState(), step: 4 };
  assert.equal(reduce(state, { type: "go-to-step", step: 1 }).step, 1);
  assert.equal(reduce(state, { type: "go-to-step", step: 5 }).step, 4);
  assert.equal(reduce(state, { type: "go-to-step", step: -1 }).step, 4);
  const tree = renderWizard(state);
  const prior = findByTestId(tree, "stepper-limits");
  assert.equal(prior.children[0].tag, "button");
  assert.deepEqual(prior.children[0].attrs.onclick, { type: "go-to-step", step: 1 });
});

// ---- 6. Reduce: update-draft mutates only the named field. ---------------
test("reduce update-draft patches only the named field", () => {
  const s0 = initialState();
  const s1 = reduce(s0, {
    type: "update-draft",
    patch: { treasury: "0xAAA" },
  });
  assert.equal(s1.draft.treasury, "0xAAA");
  assert.equal(s1.draft.asset, "STRK", "untouched fields are preserved");
});

test("editing a field clears a stale plan error so deployment review recalculates", () => {
  const state = {
    ...initialState(),
    step: 5,
    plan: null,
    planError: "Expiry is required (YYYY-MM-DD or unix seconds).",
  };
  const next = reduce(state, { type: "update-draft", patch: { expiry: "2030-01-01" } });
  assert.equal(next.draft.expiry, "2030-01-01");
  assert.equal(next.plan, null);
  assert.equal(next.planError, null);
});

test("behavior copy marks expiry required and review offers the staged Mainnet flow", () => {
  const behavior = renderWizard({ ...initialState(), step: 2 });
  assert.match(JSON.stringify(behavior), /Expiry date \(required\)/);
  assert.doesNotMatch(JSON.stringify(behavior), /Expiry \(optional\)/);
  const review = renderWizard({ ...initialState(), step: 5, plan: { status: "UNSIGNED_PLAN", network: "mainnet", declarations: [], deployments: [], setupCalls: [], requiresOwnerApproval: true } });
  assert.match(JSON.stringify(review), /Deploy Gatekeeper/);
});

// ---- 7. Reduce: toggle-ack flips the boundary acknowledgement. -----------
test("reduce toggle-ack flips the boundary acknowledgement", () => {
  const s0 = initialState();
  assert.equal(s0.acknowledgedBoundary, false);
  const s1 = reduce(s0, { type: "toggle-ack" });
  assert.equal(s1.acknowledgedBoundary, true);
  const s2 = reduce(s1, { type: "toggle-ack" });
  assert.equal(s2.acknowledgedBoundary, false);
});

// Submit remains a reducer no-op because the browser layer handles the wallet.
test("reduce submit-skeleton does not change state", () => {
  const s0 = { ...initialState(), step: 5, acknowledgedBoundary: true, plan: { gatekeeper: "x" } };
  const s1 = reduce(s0, { type: "submit-skeleton" });
  assert.deepEqual(s1, s0, "the browser layer handles submission");
});

// ---- 9. computePlan: returns a helpful error when the treasury is empty. -
test("computePlan refuses to predict with an empty treasury", () => {
  const result = computePlan(blankDraft(), { buildTreasuryDeploymentPlan: () => ({ ok: true }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /treasury/i);
});

// ---- 9b. computePlan: refuses to predict when the recipient/operator are empty.
test("computePlan refuses to predict when the payment recipient is missing", () => {
  const draft = { ...blankDraft(), treasury: "0xOWNER", cap: "1", budget: "1", expiry: "2030-01-01", mode: "reusable" };
  const r1 = computePlan(draft, { buildTreasuryDeploymentPlan: () => ({}) });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /recipient/i);
  const r2 = computePlan(
    { ...draft, recipient: "0xR" },
    { buildTreasuryDeploymentPlan: () => ({}) },
    TEST_NETWORK_CONFIG,
  );
  assert.equal(r2.ok, true);
});

// ---- 9c. computePlan: refuses to predict when budget < cap.
test("computePlan refuses to predict when the budget is below the cap", () => {
  const draft = {
    ...blankDraft(),
    treasury: "0xOWNER",
    recipient: "0xR",
    operator: "0xO",
    cap: "2",
    budget: "1",
    expiry: "2030-01-01",
    mode: "reusable",
    supply: "1",
  };
  const result = computePlan(draft, { buildTreasuryDeploymentPlan: () => ({}) });
  assert.equal(result.ok, false);
  assert.match(result.error, /budget/i);
});

// ---- 9d. computePlan: refuses to predict when the expiry is missing.
test("computePlan refuses to predict when the expiry is missing", () => {
  const draft = {
    ...blankDraft(),
    treasury: "0xOWNER",
    recipient: "0xR",
    operator: "0xO",
    cap: "1",
    budget: "1",
    mode: "reusable",
    supply: "1",
  };
  const result = computePlan(draft, { buildTreasuryDeploymentPlan: () => ({}) });
  assert.equal(result.ok, false);
  assert.match(result.error, /expiry/i);
});

// ---- 9e. computePlan: refuses to predict when the mode is missing.
test("computePlan refuses to predict when the capability mode is missing", () => {
  const draft = {
    ...blankDraft(),
    treasury: "0xOWNER",
    recipient: "0xR",
    operator: "0xO",
    cap: "1",
    budget: "1",
    expiry: "2030-01-01",
    supply: "1",
  };
  const result = computePlan(draft, { buildTreasuryDeploymentPlan: () => ({}) });
  assert.equal(result.ok, false);
  assert.match(result.error, /behavior|mode|reusable|one-shot/i);
});

// computePlan calls the real SDK shape.
// The SDK input must include every field the upstream
// `buildTreasuryDeploymentPlan` declares: network, privacyPool,
// issuer, treasury, asset, recipient, capabilityName,
// capabilitySymbol, maxAmount, expiresAt, supply,
// treasuryAllowance, reusable. This test asserts the full shape.
test("computePlan calls buildTreasuryDeploymentPlan with the full real SDK input shape", () => {
  let called = null;
  const fakeSdk = {
    buildTreasuryDeploymentPlan: (args) => {
      called = args;
      return {
        status: "UNSIGNED_PLAN",
        network: "mainnet",
        requiresOwnerApproval: true,
        declarations: ["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"],
        deployments: [
          { id: "gatekeeper", contract: "CapabilityGatekeeper", constructor: ["0xPOOL"] },
          { id: "treasuryAdapter", contract: "TreasurySpendAdapter", constructor: ["$gatekeeper", "0xT", "0xA", "0xR"] },
          { id: "capabilityToken", contract: "CapabilityToken", constructor: ["BBXS-20300101-1", "BBXS", "0xI", "0xPOOL", "$gatekeeper"] },
        ],
        setupCalls: [
          { signerRole: "issuer", contract: "$gatekeeper", entrypoint: "register_policy", arguments: ["$capabilityToken", "$treasuryAdapter", "selector:spend", true, "0x1", "0x65f0a4d8", false] },
          { signerRole: "treasury", contract: "0xASSET", entrypoint: "approve", arguments: ["$treasuryAdapter", "0x1"] },
          { signerRole: "issuer", contract: "$capabilityToken", entrypoint: "mint", arguments: ["0xISSUER", "0x1"] },
        ],
        warnings: ["warn"],
      };
    },
  };
  const draft = {
    ...blankDraft(),
    treasury: "0xOWNER",
    recipient: "0xR",
    operator: "0xO",
    cap: "1",
    budget: "1",
    supply: "1",
    expiry: "2030-01-01",
    mode: "reusable",
    asset: "STRK",
  };
  const result = computePlan(draft, fakeSdk, TEST_NETWORK_CONFIG);
  assert.equal(result.ok, true);
  // Field-by-field shape check (not deep-equal — derived names use
  // the draft's expiry/cap, so we assert the stable fields only).
  assert.equal(called.network, "mainnet");
  assert.equal(called.privacyPool, "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a");
  assert.equal(called.issuer, "0xOWNER");
  assert.equal(called.treasury, "0xOWNER");
  assert.equal(called.recipient, "0xR");
  assert.equal(called.reusable, true);
  assert.equal(called.supply, 1n);
  assert.equal(called.maxAmount, 1000000000000000000n);
  assert.equal(called.treasuryAllowance, 1000000000000000000n);
  assert.match(called.capabilityName, /^BBXS-/);
  assert.equal(called.capabilitySymbol, "BBXS");
  // Plan is returned as-is.
  assert.equal(result.plan.status, "UNSIGNED_PLAN");
});

// ---- 10b. End-to-end: the REAL SDK returns the shape the
// wizard renders. This closes the
// mutation-test gap from a synthetic-plan test.) ----
// Test 10 above exercises the wizard's input shape against a
// fake SDK; this test calls the real local SDK with a valid
// 12-field input and asserts the real return shape matches
// what the rail renders. If the SDK's return shape drifts
// (e.g. drops the mint call), this test fails. If the rail
// test that follows starts asserting a stale shape, this
// test still holds the line.
import { buildTreasuryDeploymentPlan as realBuildTreasuryDeploymentPlan } from "../src/sdk/blackbox-capability-sdk.mjs";
test("real SDK end-to-end: returns the 3+3+3 UNSIGNED_PLAN shape (gate evidence)", () => {
  // Starknet felt252 range: 0 < value < 2^251 + 17*2^192.
  // Use small, definitely-in-range addresses (0x1, 0x2, 0x3)
  // rather than repeating-hex strings that overflow felt252.
  const input = {
    network: "mainnet",
    privacyPool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    issuer: "0x1",
    treasury: "0x1",
    asset: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    recipient: "0x2",
    capabilityName: "BBX Studio Test",
    capabilitySymbol: "BBXS",
    maxAmount: 1000000000000000000n,
    expiresAt: 1893456000n,
    supply: 1n,
    treasuryAllowance: 1000000000000000000n,
    reusable: true,
  };
  const plan = realBuildTreasuryDeploymentPlan(input);
  // Shape: status banner + 3 declarations + 3 deployments + 3 setup calls.
  assert.equal(plan.status, "UNSIGNED_PLAN");
  assert.equal(plan.network, "mainnet");
  assert.equal(plan.requiresOwnerApproval, true);
  assert.equal(plan.declarations.length, 3);
  assert.deepEqual(plan.declarations, [
    "CapabilityGatekeeper",
    "CapabilityToken",
    "TreasurySpendAdapter",
  ]);
  assert.equal(plan.deployments.length, 3);
  assert.deepEqual(plan.deployments.map((d) => d.id), [
    "gatekeeper",
    "treasuryAdapter",
    "capabilityToken",
  ]);
  // The 3 setup calls, in order. The third (mint) is the
  // The real SDK must return this field. The
  // rail must render it.
  assert.equal(plan.setupCalls.length, 3);
  assert.equal(plan.setupCalls[0].entrypoint, "register_policy");
  assert.equal(plan.setupCalls[0].signerRole, "issuer");
  assert.equal(plan.setupCalls[1].entrypoint, "approve");
  assert.equal(plan.setupCalls[1].signerRole, "treasury");
  assert.equal(plan.setupCalls[2].entrypoint, "mint");
  assert.equal(plan.setupCalls[2].signerRole, "issuer");
  assert.equal(plan.setupCalls[2].contract, "$capabilityToken");
  // Public configuration export consumes this same plan —
  // assert it is JSON-serializable and contains the SDK
  // class hash (the real one from the SDK's table, not a
  // placeholder).
  const cfg = publicConfiguration(
    { treasury: input.treasury, recipient: input.recipient, cap: "1", budget: "1", supply: "1", expiry: "2030-01-01", mode: "reusable" },
    plan,
    TEST_NETWORK_CONFIG,
  );
  assert.equal(cfg.network, "mainnet");
  assert.equal(cfg.requiresOwnerApproval, true);
  assert.ok(cfg.classHashes, "publicConfiguration includes classHashes");
  // Real SDK returns 3 class hashes; the export is the
  // bridge from SDK to UI, so it must carry them through.
  assert.equal(Object.keys(cfg.classHashes).length, 3);
  // The calldata export is also derived from the real plan.
  const code = calldataExport(plan);
  assert.match(code, /---- Declarations/);
  assert.match(code, /---- Deployments/);
  assert.match(code, /---- Setup calls/);
  // The mint entrypoint appears in the calldata export.
  assert.match(code, /entrypoint=mint/);
});

// ---- 11. computePlan: surfaces SDK throws as a planError. -----------------
// The wizard has a hard contract: if the SDK throws, the user sees a
// planError in the rail rather than a crash. The wizard must also
// have already validated the draft enough to NOT short-circuit on
// a missing required field — so this test fills in the minimum
// required draft (treasury, recipient, operator, cap, budget,
// supply, expiry, mode) so the throw is the only path that fires.
test("computePlan catches SDK throws and returns a planError", () => {
  const fakeSdk = {
    buildTreasuryDeploymentPlan: () => {
      throw new Error("class hash not configured");
    },
  };
  const draft = {
    ...blankDraft(),
    treasury: "0xOWNER",
    recipient: "0xR",
    operator: "0xO",
    cap: "1",
    budget: "1",
    supply: "1",
    expiry: "2030-01-01",
    mode: "reusable",
  };
  const result = computePlan(draft, fakeSdk, TEST_NETWORK_CONFIG);
  assert.equal(result.ok, false);
  assert.match(result.error, /class hash/);
});

// ---- 12. The review step's rail surfaces the real plan structure. --------
// The rail reads from the real UNSIGNED_PLAN shape:
// declarations (with class hashes), deployments (with constructor
// args), setup calls (with entrypoint + signer role), and the
// requiresOwnerApproval banner. The test must assert each of these
// is present, with the right testids, and the right field-level
// content.
//
// Format the rail actually renders:
//   "<n>. <signerRole> → <contract>.<entrypoint>"
// (NO literal word "signer" — we read the rendered text, not the
// underlying setupCalls object).
test("review-step render includes the real predicted deployment plan rail when present", () => {
  const plan = {
    status: "UNSIGNED_PLAN",
    network: "mainnet",
    requiresOwnerApproval: true,
    declarations: ["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"],
    deployments: [
      { id: "gatekeeper", contract: "CapabilityGatekeeper", constructor: ["0xPOOL"] },
      { id: "treasuryAdapter", contract: "TreasurySpendAdapter", constructor: ["$gatekeeper", "0xT", "0xA", "0xR"] },
      { id: "capabilityToken", contract: "CapabilityToken", constructor: ["BBXS", "BBXS-SYM", "0xI", "0xPOOL", "$gatekeeper"] },
    ],
    setupCalls: [
      { signerRole: "issuer", contract: "$gatekeeper", entrypoint: "register_policy", arguments: ["$capabilityToken", "$treasuryAdapter", "selector:spend", true, "0x1", "0x65f0a4d8", false] },
      { signerRole: "treasury", contract: "0xASSET", entrypoint: "approve", arguments: ["$treasuryAdapter", "0x1"] },
      { signerRole: "issuer", contract: "$capabilityToken", entrypoint: "mint", arguments: ["0xI", "0xDE0B6B3A7640000"] },
    ],
    warnings: [],
  };
  const state = {
    ...initialState(),
    step: 5,
    plan,
    draft: {
      ...blankDraft(),
      treasury: "0xOWNER",
      recipient: "0xR",
      operator: "0xO",
      cap: "1",
      budget: "1",
      supply: "1",
      expiry: "2030-01-01",
      mode: "reusable",
    },
  };
  const tree = renderWizard(state);
  const planRail = findByTestId(tree, "rail-plan");
  assert.ok(planRail, "plan rail is rendered when state.plan is set");

  // All three declared classes render with their class hash, not
  // placeholder text. This catches the "rendered the rail but
  // forgot the class hash" regression.
  const decls = findByTestId(tree, "rail-declarations");
  assert.ok(decls, "declarations list is rendered");
  for (const cls of plan.declarations) {
    const decl = findByTestId(tree, `rail-decl-${cls}`);
    assert.ok(decl, `declaration ${cls} is rendered`);
    assert.match(JSON.stringify(decl), /0x[0-9a-f]{60,}/i, `${cls} shows its class hash`);
  }

  // Deployments: the symbolic $gatekeeper ref must show up in the
  // adapter constructor calldata — this is the test that catches
  // "we forgot to pass the gatekeeper to the adapter".
  const adapter = findByTestId(tree, "rail-deploy-treasuryAdapter");
  assert.ok(adapter, "treasuryAdapter deployment is rendered");
  assert.match(JSON.stringify(adapter), /\$gatekeeper/);

  // Setup calls: the issuer-signed register_policy call must come
  // before the treasury-signed approve call. The rail renders
  // each as "<n>. <signerRole> → <contract>.<entrypoint>".
  // The real SDK returns THREE setup calls — register_policy,
  // approve, mint. The third is the issuer-signed mint to
  // initialise the private capability supply; this is the
  // mint plan used by the deployment review.
  const setup0 = findByTestId(tree, "rail-setup-0");
  const setup1 = findByTestId(tree, "rail-setup-1");
  const setup2 = findByTestId(tree, "rail-setup-2");
  assert.ok(setup0 && setup1 && setup2, "all three setup calls render");
  assert.match(JSON.stringify(setup0), /register_policy/);
  assert.match(JSON.stringify(setup0), /\bissuer\b/);
  assert.match(JSON.stringify(setup0), /\$gatekeeper/);
  assert.match(JSON.stringify(setup1), /approve/);
  assert.match(JSON.stringify(setup1), /\btreasury\b/);
  assert.match(JSON.stringify(setup1), /0xASSET/);
  assert.match(JSON.stringify(setup2), /\bmint\b/);
  assert.match(JSON.stringify(setup2), /\bissuer\b/);
  assert.match(JSON.stringify(setup2), /\$capabilityToken/);

  // Public configuration export is rendered. The rail embeds the
  // JSON config as a string inside the testid's children; when that
  // testid tree gets JSON.stringify'd, the inner quotes become
  // backslash-escaped. The test asserts the substrings we expect
  // to find, in the escaped form that JSON.stringify produces.
  const cfg = findByTestId(tree, "rail-config-json");
  assert.ok(cfg, "public configuration JSON is rendered");
  assert.match(JSON.stringify(cfg), /\\"network\\": \\"mainnet\\"/);
  assert.match(JSON.stringify(cfg), /\\"requiresOwnerApproval\\": true/);

  // SDK calldata export is rendered with the declared classes
  // listed and the contracts visible.
  const cd = findByTestId(tree, "rail-calldata");
  assert.ok(cd, "SDK calldata export is rendered");
  assert.match(JSON.stringify(cd), /CapabilityGatekeeper/);
  assert.match(JSON.stringify(cd), /treasuryAdapter/);
  assert.match(JSON.stringify(cd), /\$gatekeeper/);
  assert.match(JSON.stringify(cd), /UNSIGNED calldata export/);
});

// ---- 13. The review step surfaces the planError when present. -----------
test("review-step render includes a plan-error rail when state.planError is set", () => {
  const state = {
    ...initialState(),
    step: 5,
    planError: "Treasury wallet is required to predict the deployment plan.",
  };
  const tree = renderWizard(state);
  const err = findByTestId(tree, "rail-plan-error");
  assert.ok(err, "error rail is rendered when state.planError is set");
});

// ---- 14. Privacy review requires boundary acknowledgement. --------------
test("continue button is disabled on privacy review without acknowledgement", () => {
  const state = { ...initialState(), step: 4, plan: { gatekeeper: "0xGK" } };
  const tree = renderWizard(state);
  assert.ok(findByTestId(tree, "form-privacy-review"), "privacy review has its own form");
  assert.ok(findByTestId(tree, "input-ack-boundary"), "privacy review shows the acknowledgement control");
  const btn = findByTestId(tree, "btn-continue");
  assert.ok(btn, "continue button must exist");
  assert.equal(btn.attrs.disabled, "disabled", "continue disabled without ack");
});

// ---- 15. Live deployment must not be offered without its verified adapter. -
test("deployment review enables the first Mainnet stage for a connected wallet", () => {
  const state = {
    ...initialState(),
    step: 5,
    plan: { gatekeeper: "0xGK" },
    acknowledgedBoundary: true,
    wallet: { address: "0xWALLET", chainId: "0x534e5f4d41494e" },
  };
  const tree = renderWizard(state);
  const btn = findByTestId(tree, "mainnet-deploy-next");
  assert.equal(btn.attrs.disabled, null);
  assert.equal(getButtonText(btn), "Deploy Gatekeeper");
});

// ---- 15b. The reason stays honest when no wallet is connected. ------------
test("deployment review requires a connected wallet", () => {
  const state = {
    ...initialState(),
    step: 5,
    plan: { gatekeeper: "0xGK" },
    acknowledgedBoundary: true,
    // no wallet
  };
  const tree = renderWizard(state);
  const btn = findByTestId(tree, "mainnet-deploy-next");
  assert.equal(btn.attrs.disabled, "disabled");
  assert.equal(getButtonText(btn), "Deploy Gatekeeper");
});

// ---- 16. Continue requires a complete, valid current step. --------------
test("continue only enables after each configuration step is complete", () => {
  const base = initialState({ draft: { cap: "1", budget: "2", supply: "1", mode: "reusable", expiry: "2099-01-01" } });
  for (let i = 1; i < 4; i++) {
    const tree = renderWizard({ ...base, step: i });
    const btn = findByTestId(tree, "btn-continue");
    assert.equal(btn.attrs.disabled, null, `completed step ${i} continue must be enabled`);
  }
  const invalid = renderWizard({ ...initialState(), step: 1 });
  assert.equal(findByTestId(invalid, "btn-continue").attrs.disabled, "disabled");
});

// ---- 17. The wizard does NOT ship any obvious secrets to its tree. ------
// (The secret-scan is the system-level guarantee; this is a smoke
// test that the wizard itself does not import any secret-bearing
// file.)
test("wizard.mjs source does not contain any obviously seeded private key or seed phrase", () => {
  const src = readFileSync(join(studioRoot, "src/ui/wizard.mjs"), "utf8");
  assert.doesNotMatch(src, /private[_-]?key\s*[:=]\s*["']?[0-9a-f]{16,}/i);
  assert.doesNotMatch(src, /seed[_-]?phrase\s*[:=]/i);
  assert.doesNotMatch(src, /mnemonic\s*[:=]\s*["'][a-z ]+["']/i);
});

// ---- 18. The tree size is bounded. ---------------------------------------
// Catches accidental infinite trees from a render bug.
test("initial render tree is bounded under 600 nodes", () => {
  const tree = renderWizard(initialState());
  const total = countWhere(tree, () => true);
  assert.ok(total > 5, "tree must have real content");
  assert.ok(total < 600, `tree unexpectedly large: ${total} nodes`);
});

// ---- 19. The tree is deterministic for the same state. -------------------
test("rendering the same state twice produces the same testid list", () => {
  const state = initialState();
  const a = listTestIds(renderWizard(state));
  const b = listTestIds(renderWizard(state));
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
});

// ---- 20. Review-step render lists a known set of testids. ---------------
test("review-step render contains the expected data-testids", () => {
  const state = {
    ...initialState(),
    step: 5,
    plan: { gatekeeper: "0xGK", token: "0xTK", adapter: "0xAD" },
  };
  const tree = renderWizard(state);
  const ids = new Set(listTestIds(tree));
  for (const required of [
    "wizard",
    "stepper",
    "stepper-deployment-review",
    "form-deployment-review",
    "review-rail",
    "rail-plan",
    "btn-back",
    "mainnet-deploy-next",
  ]) {
    assert.ok(ids.has(required), `missing data-testid: ${required}`);
  }
});

// ---- 21. Wallet controls live in the persistent shell, not the form. -------
test("treasury step does not duplicate the shell wallet controls", () => {
  const tree = renderWizard(initialState());
  assert.equal(findByTestId(tree, "btn-connect-wallet"), null);
  assert.equal(findByTestId(tree, "btn-disconnect-wallet"), null);
  assert.match(JSON.stringify(findByTestId(tree, "connected-treasury")), /Connect the treasury wallet/);
  const continueBtn = findByTestId(tree, "btn-continue");
  assert.equal(continueBtn.attrs.disabled, "disabled");
  assert.equal(getButtonText(continueBtn), "Connect treasury wallet to continue");
});

// ---- 22. Treasury identity is shown without another disconnect control. ----
test("treasury step shows only the connected treasury identity", () => {
  const state = {
    ...initialState(),
    wallet: { address: "0xDEADBEEF", chainId: "0x534e5f4d41494e" },
  };
  const tree = renderWizard(state);
  assert.equal(findByTestId(tree, "connect-connected"), null);
  assert.equal(findByTestId(tree, "btn-disconnect-wallet"), null);
  assert.match(JSON.stringify(findByTestId(tree, "connected-treasury")), /DEADBEEF/);
});

// ---- 23. reduce connect-wallet sets the wallet and fills the treasury. -----
test("reduce connect-wallet stores the address and prefills the treasury draft", () => {
  const s0 = initialState();
  const s1 = reduce(s0, {
    type: "connect-wallet",
    address: "0xWALLET",
    chainId: "0x534e5f4d41494e",
  });
  assert.deepEqual(s1.wallet, {
    address: "0xWALLET",
    chainId: "0x534e5f4d41494e",
  });
  assert.equal(s1.draft.treasury, "0xWALLET", "treasury prefilled from connected wallet");
  // Untouched fields preserved.
  assert.equal(s1.draft.asset, "STRK");
});

// ---- 23b. Connecting a wallet invalidates a stale prediction plan. ---------
test("reduce connect-wallet clears a stale plan so app.mjs recomputes on Review", () => {
  const s0 = {
    ...initialState(),
    step: 5,
    plan: { gatekeeper: "0xOLD" },
    planError: null,
  };
  const s1 = reduce(s0, {
    type: "connect-wallet",
    address: "0xNEW",
    chainId: "0x534e5f4d41494e",
  });
  assert.equal(s1.plan, null, "stale plan cleared on wallet connect");
  assert.equal(s1.planError, null);
});

// ---- 24. reduce disconnect-wallet clears the wallet. ----------------------
test("reduce disconnect-wallet clears the wallet back to null", () => {
  const s0 = {
    ...initialState(),
    wallet: { address: "0xWALLET", chainId: "0x534e5f4d41494e" },
  };
  const s1 = reduce(s0, { type: "disconnect-wallet" });
  assert.equal(s1.wallet, null);
});

// ---- 25. Wallet connection is not duplicated inside the wizard. -----------
test("wizard delegates wallet connection to the persistent shell", () => {
  const tree = renderWizard(initialState());
  assert.equal(findByTestId(tree, "btn-connect-wallet"), null);
});

// ---- 26. wizard.mjs source stays DOM-free even with the wallet surface. ----
test("wizard.mjs source contains no browser-global references", () => {
  const src = readFileSync(join(studioRoot, "src/ui/wizard.mjs"), "utf8");
  assert.doesNotMatch(src, /\bwindow\b/, "wizard.mjs must not reference window");
  assert.doesNotMatch(src, /\bdocument\b/, "wizard.mjs must not reference document");
  assert.doesNotMatch(src, /\bethereum\b/, "wizard.mjs must not reference window.ethereum");
});

// ---- 27. publicConfiguration: deterministic, no secrets, schema complete. -
// The JSON export must round-trip into a stable shape, and
// must NEVER contain signer material, private keys, or anything that
// could leak. We freeze the export and check the shape so any
// future drift fails loud.
test("publicConfiguration returns a frozen export with no secrets and the real plan fields", () => {
  const draft = {
    ...blankDraft(),
    treasury: "0xOWNER",
    recipient: "0xR",
    operator: "0xO",
    cap: "1",
    budget: "1",
    supply: "1",
    expiry: "2030-01-01",
    mode: "reusable",
    asset: "STRK",
  };
  const plan = {
    status: "UNSIGNED_PLAN",
    network: "mainnet",
    requiresOwnerApproval: true,
    warnings: ["example warning"],
  };
  const cfg = publicConfiguration(draft, plan, TEST_NETWORK_CONFIG);
  assert.ok(cfg, "publicConfiguration returns a value");
  assert.equal(Object.isFrozen(cfg), true, "publicConfiguration returns a frozen object");
  assert.equal(cfg.network, "mainnet");
  assert.equal(cfg.requiresOwnerApproval, true);
  assert.equal(cfg.warnings[0], "example warning");
  // No secrets.
  const json = JSON.stringify(cfg);
  assert.doesNotMatch(json, /private[_-]?key/i);
  assert.doesNotMatch(json, /seed/i);
  assert.doesNotMatch(json, /mnemonic/i);
  // Real public fields.
  assert.equal(cfg.publicInputs.treasury, "0xOWNER");
  assert.equal(cfg.publicInputs.recipient, "0xR");
  assert.equal(cfg.publicInputs.behavior, "reusable");
  assert.equal(cfg.publicInputs.maxAmount, "1");
  // Class hashes are the public, onchain constants.
  assert.match(cfg.classHashes.CapabilityGatekeeper, /^0x[0-9a-f]{60,}$/i);
  assert.match(cfg.classHashes.CapabilityToken, /^0x[0-9a-f]{60,}$/i);
  assert.match(cfg.classHashes.TreasurySpendAdapter, /^0x[0-9a-f]{60,}$/i);
  // Stability: same input → same output.
  const cfg2 = publicConfiguration(draft, plan, TEST_NETWORK_CONFIG);
  assert.equal(JSON.stringify(cfg), JSON.stringify(cfg2));
});

// ---- 28. publicConfiguration returns null on no plan. ----------------------
test("publicConfiguration returns null when no plan is provided", () => {
  const draft = blankDraft();
  assert.equal(publicConfiguration(draft, null), null);
});

// ---- 29. calldataExport: produces developer-readable, ordered output. -----
// The export is what a developer adapts in a deploy
// script. It must list declarations, deployments, and setup calls
// in the order a wallet would execute them. We assert that order
// invariant so a future re-ordering fails loud.
test("calldataExport lists declarations, deployments, then setup calls in order", () => {
  const plan = {
    status: "UNSIGNED_PLAN",
    network: "mainnet",
    requiresOwnerApproval: true,
    declarations: ["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"],
    deployments: [
      { id: "gatekeeper", contract: "CapabilityGatekeeper", constructor: ["0xPOOL"] },
      { id: "treasuryAdapter", contract: "TreasurySpendAdapter", constructor: ["$gatekeeper", "0xT", "0xA", "0xR"] },
      { id: "capabilityToken", contract: "CapabilityToken", constructor: ["BBXS", "BBXS-SYM", "0xI", "0xPOOL", "$gatekeeper"] },
    ],
    setupCalls: [
      { signerRole: "issuer", contract: "$gatekeeper", entrypoint: "register_policy", arguments: ["$capabilityToken", "$treasuryAdapter", "selector:spend", true, "0x1", "0x65f0a4d8", false] },
      { signerRole: "treasury", contract: "0xASSET", entrypoint: "approve", arguments: ["$treasuryAdapter", "0x1"] },
      { signerRole: "issuer", contract: "$capabilityToken", entrypoint: "mint", arguments: ["0xI", "0xDE0B6B3A7640000"] },
    ],
    privacySteps: ["issuer signs the policy", "treasury approves the allowance"],
  };
  const out = calldataExport(plan);
  const iDecl = out.indexOf("---- Declarations");
  const iDep = out.indexOf("---- Deployments");
  const iSetup = out.indexOf("---- Setup calls");
  assert.ok(iDecl >= 0 && iDep > iDecl && iSetup > iDep, "sections appear in order");
  // Each declared class shows its class hash in the format
  //   // declare: <Name> (classHash: 0x<hash>)
  // which is what calldataExport actually writes (line comments, not
  // bare class-hash lines). The regex captures the "Name" + "0x…"
  // pair so any drift from the format fails loud.
  assert.match(out, /declare: CapabilityGatekeeper \(classHash: 0x[0-9a-f]{60,}\)/i);
  assert.match(out, /declare: CapabilityToken \(classHash: 0x[0-9a-f]{60,}\)/i);
  assert.match(out, /declare: TreasurySpendAdapter \(classHash: 0x[0-9a-f]{60,}\)/i);
  // Each deployment shows its contract + constructor args.
  assert.match(out, /treasuryAdapter \(TreasurySpendAdapter\) constructor/);
  assert.match(out, /"\$gatekeeper"/);
  // Each setup call shows signer role + entrypoint + calldata in the
  // exact format calldataExport uses:
  //   // signer=<role> target=<contract> entrypoint=<name>
  assert.match(out, /signer=issuer target=\$gatekeeper entrypoint=register_policy/);
  assert.match(out, /signer=treasury target=0xASSET entrypoint=approve/);
  // The third setup call is the issuer-signed mint.
  // requires a mint plan; this is the proof the export covers it.
  assert.match(out, /signer=issuer target=\$capabilityToken entrypoint=mint/);
  // Privacy steps are listed.
  assert.match(out, /Privacy steps/);
  assert.match(out, /issuer signs the policy/);
  // Banner: required owner approval is shown explicitly.
  assert.match(out, /Owner approval required: YES/);
});

// ---- 30. calldataExport returns null on no plan. ---------------------------
test("calldataExport returns null when no plan is provided", () => {
  assert.equal(calldataExport(null), null);
});
