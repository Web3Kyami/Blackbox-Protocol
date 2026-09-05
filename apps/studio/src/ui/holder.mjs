// =============================================================================
// Studio holder experience view.
// =============================================================================
//
// Pure render (no side effects). Produces the NodeTree for the holder view:
//   - token input (the shared-link identity) + "Load policy"
//   - once a record is loaded: capability card + status banner for every
//     state (wallet / permission / expiry / revocation / transaction /
//     completion) derived from classifyPolicy()
//   - an exercise panel for the policy-defined payment.
//
// All data comes from the normalized policy record. No addresses are
// hardcoded. The view never calls the chain. Actions go through the
// app handler -> holder-action.mjs -> the connected privacy wallet.
// =============================================================================

// Small helpers (NodeTree shape is {tag, attrs, children} from mount.mjs).
const h = (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] });
const el = (tag, attrs, ...kids) => h(tag, attrs, kids.flat(Infinity));
import { formatTokenAmount } from "./format.mjs";

// Human label for the policy selector (the only real identity we have for the
// action is the target contract + selector; we surface both verbatim).
function short(value) { return value && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "—"; }

// Status banner is derived only from public policy state. Studio cannot infer
// private-note ownership from a public token address.
function statusBanner(state, record) {
  const p = record.policy || {};
  switch (state) {
    case "expired":
      return el("div", { class: "hb-banner hb-banner--exp" }, [
        el("strong", {}, ["Expired"]),
        el("span", {}, [` This capability expired at ${new Date((p.expiresAt || 0) * 1000).toISOString()}.`]),
      ]);
    case "revoked":
      return el("div", { class: "hb-banner hb-banner--rev" }, [
        el("strong", {}, ["Revoked"]),
        el("span", {}, [" This permission has been deactivated by the treasury."]),
      ]);
    case "active":
      return el("div", { class: "hb-banner hb-banner--ok" }, [
        el("strong", {}, ["Policy is active"]),
        el("span", {}, [" A compatible privacy wallet must prove it controls a private pass before it can submit this policy-defined action."]),
      ]);
    default:
      return el("div", { class: "hb-banner" }, ["Unknown state."]);
  }
}

// Exercise panel. The wallet owns proof generation and confirmation.
function exercisePanel(policyState, state, record) {
  // `policyState` is the holder-read state, not the whole app state. A
  // successful public policy read is represented as "complete" here; the
  // public lifecycle state is still rendered separately by statusBanner.
  if (policyState !== "complete") return null;
  const iss = state?.holder?.issuance || state?.issuance || {};
  const fields = (iss && iss.fields) || {};
  const maxFirstArg = formatTokenAmount(record?.policy?.maxFirstArg ?? record?.maxFirstArg, record?.tokenSymbol);
  if (state?.holder?.view === "complete" && iss.receipt?.txHash) {
    const remaining = formatTokenAmount(record?.remainingBudget || "0", record?.tokenSymbol);
    return el("section", { class: "hb-exercise hb-exercise--complete" }, [
      el("span", { class: "studio-kicker" }, ["PAYMENT CONFIRMED"]),
      el("h3", {}, [`${fields.amount || "0"} ${record?.tokenSymbol || "STRK"} sent`]),
      el("p", {}, ["The treasury payment was confirmed on Mainnet."]),
      record?.postPaymentStateVerified !== false
        ? el("p", {}, [`Remaining treasury allowance: ${remaining} ${record?.tokenSymbol || "STRK"}`])
        : null,
      el("a", {
        class: "hb-btn hb-btn--primary",
        href: `https://voyager.online/tx/${iss.receipt.txHash}`,
        target: "_blank",
        rel: "noopener noreferrer",
      }, ["View transaction"]),
    ]);
  }
  return el("section", { class: "hb-exercise" }, [
    el("h3", {}, ["Request the approved payment"]),
    el("label", {}, [
      `Payment amount (maximum ${maxFirstArg} ${record?.tokenSymbol || "STRK"})`,
      el("input", {
        type: "text", inputmode: "decimal", name: "holder-payment-amount",
        value: fields.amount ?? "",
        "aria-invalid": iss.error ? "true" : null,
        "data-action": "holder-amount",
        oninput: { type: "holder-amount", value: "@" },
      }),
      iss.error ? el("span", { class: "hb-field-error", role: "alert" }, [iss.error]) : null,
    ]),
    el("button", { class: "hb-btn hb-btn--primary", "data-action": "holder-exercise", onclick: { type: "holder-exercise" } }, ["Request payment"]),
  ]);
}

// Full holder view.
export function renderHolder(state) {
  const hstate = (state && state.holder) || { token: "", record: null, error: null, view: "input" };
  const record = hstate.record;
  const policyState = record ? record.state : null;

  const connected = state?.wallet?.address;
  const children = [
    el("h2", {}, ["Request an approved payment"]),
    el("p", { class: "hb-lede" }, ["Connect the wallet that received this permission, then review the approved payment."]),
  ];

  if (hstate.view === "loading" || hstate.view === "checking" || hstate.view === "confirming") {
    children.push(el("section", { class: "hb-load hb-load--loading" }, [
      el("strong", {}, [hstate.view === "confirming" ? "Confirming payment" : hstate.view === "checking" ? "Checking your permission" : "Loading mandate"]),
      el("p", {}, [hstate.view === "confirming" ? "Payment submitted. You can safely refresh while it confirms." : hstate.view === "checking" ? "Your wallet is checking the private permission." : "Loading the payment rule."]),
    ]));
  } else if (hstate.view === "error" || hstate.view === "no-pass") {
    children.push(el("section", { class: "hb-load hb-load--error" }, [
      el("strong", {}, [hstate.view === "no-pass" ? "No permission found" : "Could not continue"]),
      el("p", {}, [String(hstate.error || "Switch to the wallet that received the private pass.")]),
      el("button", { class: "hb-btn hb-btn--primary", "data-action": hstate.view === "no-pass" ? "connect-wallet-request" : "holder-check", onclick: { type: hstate.view === "no-pass" ? "connect-wallet-request" : "holder-check" } }, [hstate.view === "no-pass" ? "Switch wallet" : "Try again"]),
    ]));
    children.push(el("button", { class: "hb-btn", "data-action": "holder-back", onclick: { type: "holder-back" } }, ["Back"]));
  } else if (!record) {
    // Input state: paste the shared-link token.
    children.push(
      el("section", { class: "hb-load" }, [
        hstate.token
          ? el("div", { class: "operator-wallet" }, [el("span", {}, ["Payment permission ready"])])
          : el("label", { class: "operator-policy-field" }, [
              el("span", {}, ["Mandate address"]),
              el("small", {}, ["Paste the address supplied by the treasury team."]),
              el("input", {
                type: "text", placeholder: "0x…", value: "",
                "data-action": "holder-token",
                oninput: { type: "holder-token", value: "@" },
              }),
            ]),
        connected
          ? el("div", { class: "operator-wallet" }, [el("span", {}, ["Wallet connected"]), el("code", {}, [short(connected)])])
          : el("button", { class: "hb-btn hb-btn--primary", "data-action": "connect-wallet-request", onclick: { type: "connect-wallet-request" } }, ["Connect wallet"]),
        connected ? el("button", { class: "hb-btn hb-btn--primary", "data-action": "holder-check", onclick: { type: "holder-check" } }, ["Check my permission"]) : null,
        hstate.error
          ? el("div", { class: "hb-error" }, [String(hstate.error)])
          : null,
        el("button", { class: "hb-btn", "data-action": "holder-back", onclick: { type: "holder-back" } }, ["Back"]),
      ]),
    );
  } else if (hstate.permissionChecked) {
    // Loaded: capability card + status + exercise.
    const p = record.policy || {};
    children.push(
      el("section", { class: "hb-card" }, [
        el("div", { class: "hb-row" }, [el("span", {}, ["Payment recipient"]), el("code", {}, [short(record.recipient)])]),
        el("div", { class: "hb-row" }, [el("span", {}, ["Asset"]), el("strong", {}, [record.tokenSymbol || "STRK"])]),
        el("div", { class: "hb-row" }, [el("span", {}, ["Maximum per request"]), el("strong", {}, [`${formatTokenAmount(p.maxFirstArg || record.maxFirstArg, record.tokenSymbol)} ${record.tokenSymbol || "STRK"}`])]),
        el("div", { class: "hb-row" }, [el("span", {}, ["Permission"]), el("span", {}, [p.reusable ? "Reusable until budget or expiry" : "One payment only"])]),
        el("div", { class: "hb-row" }, [el("span", {}, ["Expires:"]), el("span", {}, [p.expiresAt ? new Date(p.expiresAt * 1000).toISOString() : "never"])]),
      ]),
      statusBanner(policyState, record),
      // The exercise panel receives the successful holder-read state only;
      // passing the full app state here would make the guard vacuous.
      exercisePanel(
        record.state === "active" && (hstate.view === "loaded" || hstate.view === "complete")
          ? "complete"
          : record.state,
        state,
        record,
      ),
      el("button", { class: "hb-btn", "data-action": "holder-back", onclick: { type: "holder-back" } }, ["Back"]),
    );
  } else {
    children.push(el("section", { class: "hb-load" }, [
      el("p", {}, ["Connect the wallet that received the pass."]),
      connected
        ? el("button", { class: "hb-btn hb-btn--primary", "data-action": "holder-check", onclick: { type: "holder-check" } }, ["Check my permission"])
        : el("button", { class: "hb-btn hb-btn--primary", "data-action": "connect-wallet-request", onclick: { type: "connect-wallet-request" } }, ["Connect wallet"]),
    ]));
  }
  return el("div", { class: "hb-holder" }, children.filter(Boolean));
}
