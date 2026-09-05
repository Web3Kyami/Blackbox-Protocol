// Pure render model for the Studio mandate wizard. The browser mounts this
// tree in mount.mjs, while tests can inspect it without a DOM dependency.

// Default draft state. Used both as the initial state in the browser
// and as a "blank" for tests. All string fields are empty; numerics
// are 0; mode is null until the user picks.
export const blankDraft = () => ({
  treasury: "",
  asset: "STRK",
  recipient: "",
  cap: "",
  budget: "",
  supply: "1",
  mode: null, // "reusable" | "one-shot"
  expiry: "",
});

// Steps in the wizard. Each step has a stable id (used in tests) and
// a label (used in the stepper). Privacy and deployment review are
// deliberately separate gates, matching USER_FLOW.md and the implementation
// plan: the user acknowledges disclosure before reviewing executable data.
export const STEPS = [
  { id: "treasury", label: "Treasury & payment" },
  { id: "limits", label: "Limits" },
  { id: "behavior", label: "Permission behavior" },
  { id: "operator", label: "Roles & delivery" },
  { id: "privacy-review", label: "Privacy review" },
  { id: "deployment-review", label: "Deployment review" },
];

// Role education now lives beside the fields and in deployment review. Keep
// the stable internal step id for saved-state compatibility, but do not make
// users stop on a page that repeats the same distinction.
const HIDDEN_STEP_IDS = new Set(["operator"]);

// Default review-rail copy for an empty draft. When the user types
// values, the rail updates with a per-field summary.
export function summaryFor(draft) {
  return {
    Recipient: draft.recipient || "Not set",
    Asset: draft.asset || "Not set",
    "Per-payment cap": draft.cap ? `${draft.cap} ${draft.asset}` : "Not set",
    "Total budget": draft.budget ? `${draft.budget} ${draft.asset}` : "Not set",
    "Pass supply": draft.supply || "Not set",
    "Behavior": draft.mode === "reusable"
      ? "Reusable"
      : draft.mode === "one-shot"
      ? "One-shot"
      : "Not set",
    Expiry: draft.expiry || "Required",
  };
}

// Public/private boundary copy. Shown in step 4 (Review) before the
// user can mark the boundary acknowledged. Verbatim per USER_FLOW.md
// step 5.
export const PUBLIC_PRIVATE_BOUNDARY = {
  public: [
    "Your organization wallet, policy, and contract addresses.",
    "Treasury, payment recipient, asset, payment cap, total approved budget, expiry, and behavior.",
    "When a pass is delivered through STRK20: the public deposit address, token, and amount.",
    "A payment request and its resulting onchain state change.",
  ],
  private: [
    "Which compatible wallet holds the private capability note that permits a request.",
    "The cryptographic note and proof material inside that wallet. This does not include a work brief, design file, or message.",
    "The intended holder-to-use link is not guaranteed hidden from timing, offchain communication, or wallet-relay metadata.",
  ],
};

// =============================================================================
// Tree builders (private)
// =============================================================================

// Tiny tree helpers. `h(tag, attrs, ...children)` mirrors the shape
// `mount.mjs` understands.
function h(tag, attrs, ...children) {
  return { tag, attrs: attrs || {}, children: children.flat() };
}
function text(s) {
  return { tag: "#text", attrs: {}, children: [String(s)] };
}
function flatten(nodes) {
  return nodes
    .filter((n) => n != null && n !== false)
    .map((n) => (typeof n === "string" ? text(n) : n));
}

// Stepper (left column). Completed steps are buttons so a user can revisit a
// prior decision directly. Future steps remain inert: the wizard never lets a
// step-label click bypass validation or the privacy acknowledgement.
function renderStepper(state) {
  return h(
    "ol",
    { class: "stepper", "data-testid": "stepper" },
    ...STEPS.map((s, i) => ({ s, i })).filter(({ s }) => !HIDDEN_STEP_IDS.has(s.id)).map(({ s, i }, visibleIndex) =>
      h(
        "li",
        {
          class:
            "stepper-item" +
            (i === state.step
              ? " stepper-item--active"
              : "") +
            (i < state.step
              ? " stepper-item--done"
              : ""),
          "data-step-id": s.id,
          "data-testid": `stepper-${s.id}`,
        },
        h("button", {
          type: "button",
          class: "stepper-button",
          disabled: i >= state.step ? "disabled" : null,
          "aria-current": i === state.step ? "step" : null,
          onclick: i < state.step ? { type: "go-to-step", step: i } : null,
        },
          h("span", { class: "stepper-index" }, text(visibleIndex + 1)),
          h("span", { class: "stepper-label" }, text(s.label)),
        ),
      ),
    ),
  );
}

// Form fields for a given step. Each field has a real <label> and a
// plain-language help line (UI_DIRECTION.md §"Configuration wizard").
//
// Wallet connect control. Shown on the Treasury step. Pure: the
// event it dispatches is a *request placeholder*; the browser layer
// (app.mjs) performs the actual Starknet wallet enable() call —
// which is a connection request only, no transaction and no Mainnet
// write (see AGENTS.md: no Mainnet writes without approval).
function renderStepForm(state) {
  const draft = state.draft;
  const set = (patch) => ({
    type: "update-draft",
    patch,
  });

  switch (STEPS[state.step].id) {
    case "treasury":
      return h(
        "form",
        { class: "step-form", "data-testid": "form-treasury", autocomplete: "off" },
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Treasury wallet")),
          h("span", { class: "field-help" }, text("Connect the wallet that controls the payment funds. Studio uses that address as the treasury.")),
          state.wallet?.address
            ? h("div", { class: "connected-treasury", "data-testid": "connected-treasury" }, text(state.wallet.address))
            : h("div", { class: "connected-treasury connected-treasury--empty", "data-testid": "connected-treasury" }, text("Connect the treasury wallet to continue.")),
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Payment asset")),
          h("span", { class: "field-help" }, text("The token paid to the payment recipient. The verified mandate template supports STRK.")),
          h("select", {
            name: "asset",
            "data-testid": "input-asset",
            onchange: set({ asset: "@" }),
          },
            h("option", { value: "STRK", selected: draft.asset === "STRK" ? "selected" : null }, text("STRK")),
            // Future assets: disabled + labelled "Coming next".
            h("option", { value: "ETH", disabled: "disabled" }, text("ETH, coming next")),
            h("option", { value: "USDC", disabled: "disabled" }, text("USDC, coming next")),
          ),
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Who should receive the payment?")),
          h("span", { class: "field-help" }, text("This is the vendor or beneficiary who gets paid. It is not the operator receiving the pass.")),
          h("input", {
            type: "text",
            name: "recipient",
            value: draft.recipient,
            placeholder: "0x…",
            "data-testid": "input-recipient",
            oninput: set({ recipient: "@"}),
          }),
        ),
      );
    case "limits":
      return h(
        "form",
        { class: "step-form", "data-testid": "form-limits", autocomplete: "off" },
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Maximum per payment")),
          h("span", { class: "field-help" }, text("The most STRK the contractor can request for one piece of work. Example: 20 STRK for one weekly design.")),
          h("input", {
            type: "text",
            inputmode: "decimal",
            name: "cap",
            value: draft.cap,
            placeholder: "0.0",
            "data-testid": "input-cap",
            oninput: set({ cap: "@" }),
          }),
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Total approved budget")),
          h("span", { class: "field-help" }, text("The most this mandate can pay in total before expiry. Example: 80 STRK covers four 20-STRK designs.")),
          h("input", {
            type: "text",
            inputmode: "decimal",
            name: "budget",
            value: draft.budget,
            placeholder: "0.0",
            "data-testid": "input-budget",
            oninput: set({ budget: "@" }),
          }),
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Number of permission passes")),
          h("span", { class: "field-help" }, text("Usually 1. Each pass gives one operator the contract-limited permission. It is not STRK or part of the payment amount.")),
          h("input", {
            type: "number",
            min: "1",
            name: "supply",
            value: draft.supply,
            "data-testid": "input-supply",
            oninput: set({ supply: "@" }),
          }),
        ),
      );
    case "behavior":
      return h(
        "form",
        { class: "step-form", "data-testid": "form-behavior", autocomplete: "off" },
        h(
          "fieldset",
          { class: "field" },
          h("legend", { class: "field-label" }, text("How the permission can be used")),
          h("span", { class: "field-help" }, text("Reusable lets the same pass request several payments until the total budget or expiry is reached. One-shot allows one payment only. Neither choice renews automatically next month.")),
          h(
            "label",
            { class: "radio" },
            h("input", {
              type: "radio",
              name: "mode",
              value: "reusable",
              checked: draft.mode === "reusable" ? "checked" : null,
              "data-testid": "input-mode-reusable",
              onchange: set({ mode: "reusable" }),
            }),
            text("Reusable"),
          ),
          h(
            "label",
            { class: "radio" },
            h("input", {
              type: "radio",
              name: "mode",
              value: "one-shot",
              checked: draft.mode === "one-shot" ? "checked" : null,
              "data-testid": "input-mode-one-shot",
              onchange: set({ mode: "one-shot" }),
            }),
            text("One-shot"),
          ),
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "field-label" }, text("Expiry date (required)")),
          h("span", { class: "field-help" }, text("The permission stops working after this date.")),
          h("input", {
            type: "date",
            name: "expiry",
            value: draft.expiry,
            min: new Date().toISOString().slice(0, 10),
            "data-testid": "input-expiry",
            oninput: set({ expiry: "@" }),
          }),
        ),
      );
    case "operator":
      return h(
        "section",
        { class: "step-form", "data-testid": "form-operator" },
        h("h3", { class: "field-label" }, text("Three different roles")),
        h("p", { class: "field-help" }, text("Creating this mandate sets the payment rule. It does not mint, deliver, or claim a private pass.")),
        h("dl", { class: "role-explainer" },
          h("div", null,
            h("dt", null, text("1. DAO treasury / issuer")),
            h("dd", null, text("The wallet you connected. It sets the rule and later sends a permission pass.")),
          ),
          h("div", null,
            h("dt", null, text("2. Payment recipient")),
            h("dd", null, text("The designer or vendor whose public wallet receives STRK. You already entered this address.")),
          ),
          h("div", null,
            h("dt", null, text("3. Permission holder")),
            h("dd", null, text("The person allowed to request the fixed payment. Choose them only after the mandate is deployed, in the separate Issue Pass step.")),
          ),
        ),
        h("p", { class: "field-help" }, text("For work approval, the holder is often a DAO payments manager, not the vendor. The manager releases payment after accepting the work.")),
      );
    case "privacy-review":
      return renderPrivacyReview(state);
    case "deployment-review":
      return renderDeploymentReview(state);
    default:
      return h("p", null, text("Unknown step."));
  }
}

// Step 5 (Privacy review) — public/private boundary + acknowledgement.
function renderPrivacyReview(state) {
  return h(
    "form",
    { class: "step-form", "data-testid": "form-privacy-review", autocomplete: "off" },
    h(
      "div",
      { class: "boundary" },
      h("h3", { class: "boundary-title" }, text("Public (visible onchain)")),
      h(
        "ul",
        { class: "boundary-list" },
        ...PUBLIC_PRIVATE_BOUNDARY.public.map((line) =>
          h("li", null, text(line)),
        ),
      ),
      h("h3", { class: "boundary-title" }, text("Private boundary (never onchain)")),
      h(
        "ul",
        { class: "boundary-list" },
        ...PUBLIC_PRIVATE_BOUNDARY.private.map((line) =>
          h("li", null, text(line)),
        ),
      ),
    ),
    h(
      "label",
      { class: "checkbox" },
      h("input", {
        type: "checkbox",
        name: "ack",
        checked: state.acknowledgedBoundary ? "checked" : null,
        "data-testid": "input-ack-boundary",
        onchange: { type: "toggle-ack" },
      }),
      text("I have read and acknowledge the public/private boundary above."),
    ),
  );
}

// Step 6 (Deployment review) — the plan itself is rendered in the sticky
// rail. This form keeps the main column explicit about what the final action
// means and prevents privacy acknowledgement from being visually merged with
// executable deployment data.
function renderDeploymentReview(state) {
  const progress = state.mainnet?.deployment || {};
  const stage = progress.pendingTransaction ? "Resume confirmation"
    : !progress.gatekeeper ? "Deploy Gatekeeper"
    : !progress.adapter ? "Deploy payment contract"
    : !progress.token ? "Deploy permission pass"
    : !progress.setupTransaction ? "Activate and fund mandate"
    : "Mandate active";
  const complete = !!progress.setupTransaction;
  const activationStep = (number, title, body) => h("li", null,
    h("span", null, text(number)),
    h("div", null,
      h("strong", null, text(title)),
      h("p", null, text(body)),
    ),
  );
  return h(
    "section",
    { class: "step-form deployment-review", "data-testid": "form-deployment-review" },
    h("h3", { class: "field-label" }, text("Review the plan")),
    h("p", { class: "field-help" }, text("Review the payment rule. Your wallet confirms each Mainnet transaction separately.")),
    h("ul", { class: "boundary-list" },
      h("li", null, text("BlackBox contract classes are already declared on Mainnet.")),
      h("li", null, text("Four wallet confirmations create and activate this mandate.")),
      h("li", null, text("Nothing moves until you approve it in your wallet.")),
    ),
    h("section", { class: "execution-runway", "aria-label": "Mandate activation sequence" },
      h("h4", null, text("What happens after this review")),
      h("ol", null,
        activationStep("01", "Deploy the mandate contracts", "The treasury reviews every contract and policy transaction in its wallet."),
        activationStep("02", "Fund the bounded payment rule", "Approve only the total payment budget configured for this mandate."),
        activationStep("03", "Privately deliver the permission", "Choose the operator wallet after deployment; the wallet creates and sends the private pass."),
        activationStep("04", "Share the operator link", "The public link identifies the rule. The privately held pass authorizes its use."),
      ),
      h("button", {
        type: "button",
        class: "btn btn--primary",
        disabled: !state.wallet?.address || !state.plan || complete || state.mainnet?.pending ? "disabled" : null,
        onclick: { type: "mainnet-deploy-next" },
        "data-testid": "mainnet-deploy-next",
      }, text(state.mainnet?.pending === "confirming" ? "Confirming transaction" : state.mainnet?.pending ? "Approve in wallet" : stage)),
      state.mainnet?.error ? h("p", { class: "hb-error" }, text(state.mainnet.error)) : null,
      state.mainnet?.lastTransaction ? h("p", { class: "field-help studio-mono" }, text(`Confirmed: ${state.mainnet.lastTransaction}`)) : null,
    ),
  );
}

// Right rail: live-updated summary + (on the review step) the real
// predicted deployment plan from the SDK.
//
// The review rail renders the unsigned SDK plan and public configuration.
function renderReviewRail(state) {
  const summary = summaryFor(state.draft);
  const onReview = STEPS[state.step].id === "deployment-review";

  // ---- Plan card (only on review, only when plan is present). ----------
  const planCard = onReview && state.plan
    ? h(
        "section",
        { class: "rail-card", "data-testid": "rail-plan" },
        h("h4", { class: "rail-card-title" }, text("Your payment-rule plan")),
        h("p", { class: "rail-card-help" }, text(
          "Review what the contracts will enforce before you approve anything in your wallet.",
        )),
        h("ol", { class: "human-plan" },
          h("li", null, text("Create the Gatekeeper, payment adapter, and permission-pass contract.")),
          h("li", null, text("Set the fixed recipient, per-payment cap, total budget, behavior, and expiry.")),
          h("li", null, text("The treasury later sends a private permission pass to the chosen operator.")),
        ),
        h("details", { class: "technical-details" },
          h("summary", null, text("Developer details: class hashes and calldata")),
          h("h5", { class: "rail-card-sub" }, text("Declared classes")),
          h("ul", { class: "rail-list", "data-testid": "rail-declarations" },
            ...(state.plan.declarations || []).map((cls) => h("li", { "data-testid": `rail-decl-${cls}` }, h("strong", null, text(cls)), text(": "), text(DECLARED_CLASS_HASHES[cls] || "0x?"))),
          ),
          h("h5", { class: "rail-card-sub" }, text("Deployments")),
          h("ul", { class: "rail-list", "data-testid": "rail-deployments" },
            ...(state.plan.deployments || []).map((dep) => h("li", { "data-testid": `rail-deploy-${dep.id}` }, text(`${dep.id} (${dep.contract}); constructor: [${(dep.constructor || []).map(String).join(", ")}]`))),
          ),
          h("h5", { class: "rail-card-sub" }, text("Setup calls")),
          h("ol", { class: "rail-list", "data-testid": "rail-setup-calls" },
            ...(state.plan.setupCalls || []).map((call, i) => h("li", { "data-testid": `rail-setup-${i}` }, text(`${i + 1}. ${call.signerRole} → ${call.contract}.${call.entrypoint}`))),
          ),
        ),
        h("details", { class: "technical-details" },
          h("summary", null, text("Developer export")),
          h("h5", { class: "rail-card-sub" }, text("Public configuration")),
          (() => {
            const cfg = publicConfiguration(state.draft, state.plan);
            return h("pre", {
              class: "rail-export",
              "data-testid": "rail-config-json",
              onclick: { type: "copy-export", target: "config" },
            }, text(JSON.stringify(cfg, null, 2)));
          })(),
          h("h5", { class: "rail-card-sub" }, text("SDK calldata")),
          h("pre", {
            class: "rail-export",
            "data-testid": "rail-calldata",
            onclick: { type: "copy-export", target: "calldata" },
          }, text(calldataExport(state.plan))),
        ),
      )
    : onReview && state.planError
    ? h(
        "section",
        { class: "rail-card rail-card--error", "data-testid": "rail-plan-error" },
        h("h4", { class: "rail-card-title" }, text("Deployment plan unavailable")),
        h("p", null, text(state.planError)),
      )
    : null;

  // Deployment readiness panel.
  const deployPanel = onReview && state.plan
    ? h(
        "section",
        { class: "rail-card rail-card--deploy", "data-testid": "rail-deploy-panel" },
        h("h4", { class: "rail-card-title" }, text("Deployment availability")),
        h("p", { class: "rail-card-help" }, text(
          "Mainnet is ready. Your wallet confirms one stage at a time.",
        )),
        h("p", { class: "rail-card-status" }, text(
          state.wallet?.address ? "Connected and ready for review." : "Connect the treasury wallet to continue.",
        )),
      )
    : null;

  return h(
    "aside",
    { class: "rail", "data-testid": "review-rail" },
    h(
      "section",
      { class: "rail-card" },
      h("h4", { class: "rail-card-title" }, text("Mandate summary")),
      h(
        "dl",
        { class: "rail-dl" },
        ...Object.entries(summary).map(([k, v]) =>
          h("div", { class: "rail-dl-row", "data-testid": `rail-row-${k}` },
            h("dt", null, text(k)),
            h("dd", null, text(v)),
          ),
        ),
      ),
    ),
    planCard,
    deployPanel,
  );
}

// Footer: back / continue. The Continue button is disabled on the
// Review step until the boundary is acknowledged AND the deployment
// plan is computable. On Review it also requires a connected wallet,
// because deployment is signed by the connected wallet.
function renderFooter(state) {
  const stepId = STEPS[state.step].id;
  const onPrivacyReview = stepId === "privacy-review";
  const onDeploymentReview = stepId === "deployment-review";
  const positiveAmount = (value) => {
    try { return toAtomicStrk(value) > 0n; } catch { return false; }
  };
  const addressLooksValid = (value) => {
    try { return /^0x[0-9a-f]+$/i.test(String(value || "").trim()) && BigInt(value) > 0n; }
    catch { return false; }
  };
  const validExpiry = (value) => {
    try { return !!value && toUnixExpiry(value) > 0n; }
    catch { return false; }
  };
  const canContinue = stepId === "treasury"
    ? !!state.wallet?.address && addressLooksValid(state.draft.recipient)
    : stepId === "limits"
    ? positiveAmount(state.draft.cap) && positiveAmount(state.draft.budget) && toAtomicStrk(state.draft.budget) >= toAtomicStrk(state.draft.cap) && /^\d+$/.test(state.draft.supply) && BigInt(state.draft.supply) > 0n
    : stepId === "behavior"
    ? ["reusable", "one-shot"].includes(state.draft.mode) && validExpiry(state.draft.expiry)
    : onPrivacyReview
    ? state.acknowledgedBoundary === true
    : onDeploymentReview
        ? false
      : true;
  const isLast = state.step === STEPS.length - 1;
  const backButton = h(
      "button",
      {
        type: "button",
        class: "btn btn--ghost",
        "data-testid": "btn-back",
        disabled: state.step === 0 ? "disabled" : null,
        onclick: { type: "back" },
      },
      text("Back"),
    );
  if (isLast) return h("div", { class: "wizard-footer" }, backButton);
  const continueButton = h(
      "button",
      {
        type: "button",
        class: "btn btn--primary",
        "data-testid": "btn-continue",
        disabled: canContinue ? null : "disabled",
        onclick: { type: "next" },
      },
      text(
        stepId === "treasury" && !state.wallet?.address
          ? "Connect treasury wallet to continue"
          : "Continue",
      ),
    );
  return h("div", { class: "wizard-footer" }, backButton, continueButton);
}

// =============================================================================
// Public API
// =============================================================================

// Top-level entry. Returns the full wizard tree: stepper + form + rail + footer.
export function renderWizard(state) {
  return h(
    "div",
    { class: "wizard", "data-testid": "wizard" },
    renderStepper(state),
    h(
      "main",
      { class: "wizard-main" },
      h("h2", { class: "wizard-step-title", "data-testid": "step-title" },
        text(STEPS[state.step].label),
      ),
      renderStepForm(state),
      renderFooter(state),
    ),
    renderReviewRail(state),
  );
}

// =============================================================================
// State update (also pure)
// =============================================================================
//
// The reducer is pure: the same state and event produce the same result.
//
// Events are described in the tree as {type, ...}. Special: when a
// form field has `oninput: set({treasury: "@"})`, the "@" means
// "use the input element's value at event time". In the browser,
// `mount.mjs` substitutes the real value before dispatching.

// Public class hashes used by the SDK deployment plan.
const DECLARED_CLASS_HASHES = Object.freeze({
  CapabilityGatekeeper:
    "0x62b8b737e10c4b06727e9ef672fc0163f8331388e812a249f28cc9edaa63efe",
  CapabilityToken:
    "0x408fa2fde6f253b3771c43181c8eb8c7f5f71a929c4bd74cb0b25852e5a17e7",
  TreasurySpendAdapter:
    "0x7617280a31c7ffbf16b5eb18e7f783d1953d295277b293eb816b304041a3da0",
});

// Deterministic capability-name derivation. Studio names
// are stable across re-renders for the same draft and never leak
// user data into the onchain name (the onchain name is public).
function deriveCapabilityName(draft) {
  const stamp = (draft.expiry || "noexpiry").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "noexpiry";
  const cap = (draft.cap || "0").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "0";
  return `BBXS-${stamp}-${cap}`;
}

// Convert a decimal "1.5" string into atomic STRK units
// (1 STRK = 1e18 wei). Returns a BigInt. Throws on invalid input.
// We deliberately do not support fractional wei: STRK is 18 decimals
// and we keep math in BigInt to avoid silent precision loss.
function toAtomicStrk(decimal) {
  if (decimal == null || decimal === "") throw new RangeError("amount is required");
  const s = String(decimal).trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) {
    throw new RangeError(`amount must be a positive decimal: got "${decimal}"`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 18) {
    throw new RangeError(`amount has more than 18 fractional digits: "${decimal}"`);
  }
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  // Strip leading zeros from whole part to avoid BigInt parsing edge
  // cases, but keep "0" intact.
  const wholeClean = whole.replace(/^0+(?=\d)/, "") || "0";
  return BigInt(wholeClean) * 10n ** 18n + BigInt(padded || "0");
}

// Convert a YYYY-MM-DD or unix-seconds string to a
// BigInt unix-seconds value. Empty/undefined → 0 (which the SDK
// rejects; we surface that as a planError before calling the SDK).
function toUnixExpiry(value) {
  if (value == null || value === "") return 0n;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    const n = BigInt(s);
    if (n <= 0n) throw new RangeError("expiry must be a positive unix timestamp");
    return n;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const ms = Date.parse(`${s}T23:59:59Z`);
    if (Number.isNaN(ms)) throw new RangeError(`expiry is not a valid date: "${value}"`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (ms < today.getTime()) throw new RangeError("choose today or a future date");
    return BigInt(Math.floor(ms / 1000));
  }
  throw new RangeError(
    `expiry must be "YYYY-MM-DD" or unix seconds, got "${value}"`,
  );
}

// Build the SDK input from the wizard draft.
// Returns { ok: true, input } | { ok: false, error: <first missing/invalid field> }.
// Field-level errors are surfaced to the user as planError so the
// right rail shows exactly which Treasury Mandate input is wrong.
function buildSdkInput(draft, networkConfig = {}) {
  const required = [
    ["treasury", draft.treasury, "Treasury wallet"],
    ["recipient", draft.recipient, "Approved recipient"],
  ];
  for (const [key, value, label] of required) {
    if (!value || !String(value).trim()) {
      return { ok: false, error: `${label} is required before a deployment plan can be predicted.` };
    }
  }
  let maxAmount, budget, supply, expiresAt;
  try {
    maxAmount = toAtomicStrk(draft.cap);
  } catch (e) {
    return { ok: false, error: `Maximum per payment: ${e.message}` };
  }
  try {
    budget = toAtomicStrk(draft.budget);
  } catch (e) {
    return { ok: false, error: `Total approved budget: ${e.message}` };
  }
  if (maxAmount === 0n) {
    return { ok: false, error: "Maximum per payment cannot be zero." };
  }
  if (budget === 0n) {
    return { ok: false, error: "Total approved budget cannot be zero." };
  }
  try {
    supply = BigInt(String(draft.supply || "0").trim() || "0");
  } catch {
    return { ok: false, error: "Pass supply must be a non-negative integer." };
  }
  if (supply === 0n) {
    return { ok: false, error: "Pass supply must be at least 1." };
  }
  try {
    expiresAt = toUnixExpiry(draft.expiry);
  } catch (e) {
    return { ok: false, error: `Expiry: ${e.message}` };
  }
  if (expiresAt === 0n) {
    return { ok: false, error: "Expiry is required (YYYY-MM-DD or unix seconds)." };
  }
  // treasuryAllowance must cover at least one max payment (SDK rule).
  if (budget < maxAmount) {
    return {
      ok: false,
      error: "Total approved budget must be at least one maximum per payment.",
    };
  }
  const mode = draft.mode;
  if (mode !== "reusable" && mode !== "one-shot") {
    return { ok: false, error: "Capability behavior (reusable / one-shot) is required." };
  }
  const privacyPool = networkConfig.privacyPool || draft.privacyPool;
  const assetAddress = networkConfig.asset || draft.assetAddress;
  if (!privacyPool || !assetAddress) {
    return {
      ok: false,
      error: "Network contract configuration is required before a deployment plan can be predicted.",
    };
  }
  // Treasury Mandate always uses STRK in this release; the wizard
  // already disables other assets in the UI. We pass the asset
  // through so the call shape is honest.
  return {
    ok: true,
    input: {
      network: "mainnet",
      privacyPool,
      // The connected wallet is the deployer / signer / issuer.
      // If no wallet is connected, we still build a plan with a
      // placeholder issuer so the rail can render the structure
      // for review; the deploy button stays disabled until a
      // wallet is connected (see renderFooter canContinue).
      issuer: (draft.treasury || "").trim(),
      treasury: (draft.treasury || "").trim(),
      asset: assetAddress,
      recipient: (draft.recipient || "").trim(),
      capabilityName: deriveCapabilityName(draft),
      capabilitySymbol: "BBXS",
      maxAmount,
      expiresAt,
      supply,
      treasuryAllowance: budget,
      reusable: mode === "reusable",
    },
  };
}

// Plan computation, separated so the test can call it directly. Returns
// either { ok: true, plan } or { ok: false, error }. The plan is what
// `buildTreasuryDeploymentPlan` returns from the SDK. If the SDK call
// throws (e.g. empty input), we surface the message.
//
// The two-argument form is intentional: the test can pass a mock
// `sdk` and assert the wizard calls it without faking the contract
// surface.
export function computePlan(draft, sdk, networkConfig = {}) {
  try {
    if (!sdk || typeof sdk.buildTreasuryDeploymentPlan !== "function") {
      return { ok: false, error: "SDK not available in this build." };
    }
    const built = buildSdkInput(draft, networkConfig);
    if (!built.ok) return built;
    const unsigned = sdk.buildTreasuryDeploymentPlan(built.input);
    const plan = Object.freeze({
      ...unsigned,
      capabilityName: built.input.capabilityName,
      capabilitySymbol: built.input.capabilitySymbol,
      maxAmount: built.input.maxAmount.toString(),
      expiresAt: built.input.expiresAt.toString(),
      supply: built.input.supply.toString(),
      treasuryAllowance: built.input.treasuryAllowance.toString(),
    });
    // The rail consumes the unsigned plan returned by the SDK:
    //   { status, network, declarations, deployments, setupCalls, ... }
    // plus the SDK banner "requiresOwnerApproval: true". We return
    // the plan as-is and let renderReviewRail render the relevant
    // sections.
    return { ok: true, plan };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Public configuration export. Returns a JSON-serializable
// object that contains EVERY public input the SDK plan was built
// from, plus the class hashes, but NO secrets, NO signer material,
// NO private keys, NO note plaintext. The Studio secret-scan test
// already enforces this property; this function makes the export
// explicit and reviewable.
export function publicConfiguration(draft, plan, networkConfig = {}) {
  if (!plan) return null;
  return Object.freeze({
    network: plan.network,
    classHashes: Object.freeze({ ...DECLARED_CLASS_HASHES }),
    privacyPool: networkConfig.privacyPool || draft.privacyPool || null,
    publicInputs: Object.freeze({
      treasury: (draft.treasury || "").trim(),
      recipient: (draft.recipient || "").trim(),
      asset: draft.asset,
      maxAmount: draft.cap,
      totalBudget: draft.budget,
      passSupply: draft.supply,
      behavior: draft.mode,
      expiry: draft.expiry,
      capabilityName: deriveCapabilityName(draft),
      capabilitySymbol: "BBXS",
    }),
    planStatus: plan.status,
    requiresOwnerApproval: plan.requiresOwnerApproval === true,
    warnings: Array.from(plan.warnings || []),
  });
}

// SDK calldata export. Renders the plan's deployments
// and setupCalls as a copy-pasteable JavaScript snippet. The snippet
// is a sequence of logging lines showing the literal
// contract address, entrypoint, and calldata array each call would
// send. It is not executable on its own because it has no signer,
// RPC, no broadcast. It is "executable data" in the
// broadcast step, or RPC client. A developer can adapt it in a deploy
// script, replace `$gatekeeper` with the real deployed
// address once known, and feed the calldata to a wallet adapter.
export function calldataExport(plan) {
  if (!plan) return null;
  const lines = [];
  lines.push("// BlackBox Studio — UNSIGNED calldata export");
  lines.push(`// Network: ${plan.network}`);
  lines.push(`// Status:  ${plan.status}`);
  lines.push(`// Owner approval required: ${plan.requiresOwnerApproval === true ? "YES" : "NO"}`);
  lines.push("// Resolve $gatekeeper, $capabilityToken, $treasuryAdapter after deployment.");
  lines.push("");
  lines.push("// ---- Declarations (class hashes) ----");
  for (const cls of plan.declarations || []) {
    lines.push(`// declare: ${cls} (classHash: ${DECLARED_CLASS_HASHES[cls] || "0x?"})`);
  }
  lines.push("");
  lines.push("// ---- Deployments (constructor calldata) ----");
  for (const dep of plan.deployments || []) {
    lines.push(
      `// ${dep.id} (${dep.contract}) constructor: [${dep.constructor
        .map((a) => (typeof a === "string" ? `"${a}"` : String(a)))
        .join(", ")}]`,
    );
  }
  lines.push("");
  lines.push("// ---- Setup calls (invoke calldata) ----");
  for (const call of plan.setupCalls || []) {
    lines.push(
      `// signer=${call.signerRole} target=${call.contract} entrypoint=${call.entrypoint}`,
    );
    lines.push(
      `// calldata: [${call.arguments
        .map((a) => (typeof a === "string" ? `"${a}"` : String(a)))
        .join(", ")}]`,
    );
  }
  if (Array.isArray(plan.privacySteps) && plan.privacySteps.length) {
    lines.push("");
    lines.push("// ---- Privacy steps (wallet-owned) ----");
    for (const step of plan.privacySteps) {
      lines.push(`// - ${step}`);
    }
  }
  return lines.join("\n");
}

// Reduce (state, event) -> nextState. Pure.
export function reduce(state, event) {
  if (!event || typeof event !== "object") return state;
  switch (event.type) {
    case "next":
      return { ...state, step: state.step === 2 ? 4 : Math.min(state.step + 1, STEPS.length - 1) };
    case "back":
      return { ...state, step: state.step === 4 ? 2 : Math.max(state.step - 1, 0) };
    case "go-to-step": {
      const target = Number(event.step);
      if (!Number.isInteger(target) || target < 0 || target >= state.step || HIDDEN_STEP_IDS.has(STEPS[target]?.id)) return state;
      return { ...state, step: target };
    }
    case "update-draft": {
      const draft = { ...state.draft };
      for (const [k, v] of Object.entries(event.patch)) {
        draft[k] = v;
      }
      // A prior review error must never survive an edit: otherwise a user can
      // add the missing expiry/field but remain stuck with the old error.
      return { ...state, draft, plan: null, planError: null };
    }
    case "toggle-ack":
      return { ...state, acknowledgedBoundary: !state.acknowledgedBoundary };
    case "set-plan":
      return { ...state, plan: event.plan, planError: event.error || null };
    case "connect-wallet":
      // The browser layer (app.mjs) handles the actual
      // performed in app.mjs — the browser layer runs the actual
      // Starknet enable() call — no transaction and no Mainnet write.
      // It dispatches this event with { address, chainId } once the user approves.
      // Invalidate any stale plan so app.mjs recomputes on the Review step
      // with the newly prefilled treasury address.
      return {
        ...state,
        wallet: event.address
          ? { address: event.address, chainId: event.chainId || null }
          : null,
        draft: { ...state.draft, treasury: event.address || state.draft.treasury },
        // Stale plan (computed with empty treasury) is now invalid.
        plan: null,
        planError: null,
      };
    case "disconnect-wallet":
      return { ...state, wallet: null };
    case "submit-skeleton":
      // The browser layer handles wallet submission.
      return state;
    case "copy-export":
      // The browser layer handles clipboard writes.
      return state;
    default:
      return state;
  }
}

// =============================================================================
// Tree walker (for tests and the DOM mount)
// =============================================================================
//
// A test wants to assert "the wizard contains a stepper with 5 items".
// Rather than parsing strings, we expose a small walker that finds
// nodes by data-testid. This is the test-facing surface of the
// wizard; the DOM mount has its own.

// Find the first node whose attrs[data-testid] === id.
export function findByTestId(node, id) {
  if (!node) return null;
  if (node.attrs && node.attrs["data-testid"] === id) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const hit = findByTestId(child, id);
    if (hit) return hit;
  }
  return null;
}

// Count all nodes matching a predicate. Used for "how many stepper
// items does the wizard render" type assertions.
export function countWhere(node, predicate) {
  if (!node) return 0;
  let n = predicate(node) ? 1 : 0;
  if (node.children) {
    for (const child of node.children) {
      if (typeof child === "string") continue;
      n += countWhere(child, predicate);
    }
  }
  return n;
}

// Collect every node's data-testid into a flat list. Useful for
// "the wizard has these test ids" assertions.
export function listTestIds(node, acc) {
  acc = acc || [];
  if (!node) return acc;
  if (node.attrs && node.attrs["data-testid"]) {
    acc.push(node.attrs["data-testid"]);
  }
  if (node.children) {
    for (const child of node.children) {
      if (typeof child === "string") continue;
      listTestIds(child, acc);
    }
  }
  return acc;
}

// Build a fresh initial state, optionally with a draft and a plan.
export function initialState(opts) {
  opts = opts || {};
  return {
    step: 0,
    draft: { ...blankDraft(), ...(opts.draft || {}) },
    plan: opts.plan || null,
    planError: opts.planError || null,
    acknowledgedBoundary: !!opts.acknowledgedBoundary,
    wallet: opts.wallet || null, // { address, chainId } when connected; null otherwise
    networkConfig: opts.networkConfig || null,
  };
}
