const h = (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] });
import { formatTokenAmount } from "./format.mjs";

const short = (value) => value && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "—";
const date = (epoch) => epoch ? new Date(Number(epoch) * 1000).toLocaleString() : "No expiry";

function fact(label, value, mono = false) {
  return h("div", { class: "detail-fact" }, [h("dt", {}, [label]), h("dd", { class: mono ? "studio-mono" : "" }, [String(value)])]);
}

export function renderMandateDetail(state = {}) {
  const record = state.mandate;
  if (!record) return h("section", { class: "detail-empty" }, [h("h2", {}, ["Mandate not found"]), h("button", { class: "btn", onclick: { type: "nav-dashboard" } }, ["Back to mandates"])]);
  return h("section", { class: "mandate-detail", "data-testid": "mandate-detail" }, [
    h("button", { class: "text-button", onclick: { type: "nav-dashboard" } }, ["← Treasury mandates"]),
    h("header", { class: "detail-header" }, [
      h("div", {}, [h("span", { class: "studio-kicker" }, ["TREASURY MANDATE"]), h("h1", {}, [record.tokenName || "Private Treasury Mandate"]), h("p", {}, [`Pays only ${short(record.recipient)} under the fixed rule below.`])]),
      h("span", { class: `studio-chip studio-chip--${record.state}` }, [record.state === "active" ? "Active" : record.state]),
    ]),
    h("div", { class: "detail-actions" }, [
      h("button", { class: "btn btn--primary", onclick: { type: "open-delivery", token: record.token } }, ["Issue private pass"]),
      (record.deliveryTransaction || state.delivery?.completed) ? h("button", { class: "btn btn--secondary", onclick: { type: "dashboard-action", action: "share", token: record.token } }, ["Copy operator link"]) : null,
    ]),
    state.dashboard?.notice ? h("pre", { class: "detail-notice" }, [state.dashboard.notice]) : null,
    h("div", { class: "detail-grid" }, [
      h("article", { class: "mandate-sheet" }, [
        h("span", { class: "mandate-sheet__eyebrow" }, ["ENFORCED AUTHORITY"]),
        h("h2", {}, ["Payment rule"]),
        h("dl", {}, [
          fact("Pays", short(record.recipient), true),
          fact("Maximum per request", `${formatTokenAmount(record.maxFirstArg, record.tokenSymbol)} ${record.tokenSymbol || "STRK"}`),
          fact("Budget remaining", `${formatTokenAmount(record.remainingBudget, record.tokenSymbol)} ${record.tokenSymbol || "STRK"}`),
          fact("Behavior", record.reusable ? "Reusable until budget or expiry" : "One payment only"),
          fact("Expires", date(record.expiresAt)),
          fact("Public uses", record.uses ?? 0),
        ]),
        h("div", { class: "mandate-sheet__cannot" }, [h("strong", {}, ["The operator cannot"]), h("p", {}, ["Change the recipient, asset, cap, total budget, or call an arbitrary contract."])]),
      ]),
      h("aside", { class: "detail-side" }, [
        h("section", { class: "detail-panel" }, [h("h3", {}, ["How this mandate moves"]), h("ol", {}, [h("li", {}, ["Treasury funds and activates the public rule."]), h("li", {}, ["Treasury privately delivers one pass to an operator wallet."]), h("li", {}, ["Operator opens the shared link and requests payment."]), h("li", {}, ["Contracts enforce the rule without another treasury signature."])])]),
        h("details", { class: "detail-panel technical-details" }, [h("summary", {}, ["Contract references"]), h("dl", {}, [fact("Capability token", short(record.token), true), fact("Gatekeeper", short(record.gatekeeper), true), fact("Payment adapter", short(record.adapter), true)]), h("button", { class: "btn btn--ghost", onclick: { type: "dashboard-action", action: "export", token: record.token } }, ["Export public config"])]),
      ]),
    ]),
  ]);
}
