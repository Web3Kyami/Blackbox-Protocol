const h = (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] });
import { formatTokenAmount } from "./format.mjs";
const short = (value) => value && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "—";

export function renderPassDelivery(state = {}) {
  const record = state.mandate;
  const delivery = state.delivery || { recipient: "" };
  const canonical = (value) => { try { return BigInt(value).toString(); } catch { return ""; } };
  const issuerReady = canonical(state.wallet?.address) && canonical(state.wallet?.address) === canonical(record?.treasury);
  return h("section", { class: "pass-delivery", "data-testid": "pass-delivery" }, [
    h("button", { class: "text-button", onclick: { type: "open-mandate", token: record?.token } }, ["← Mandate details"]),
    h("header", { class: "delivery-header" }, [
      h("span", { class: "studio-kicker" }, ["TREASURY ACTION"]),
      h("h1", {}, ["Deliver one private permission"]),
      h("p", {}, ["Choose the operator wallet that should receive the capability. This wallet is not the payment recipient unless you intentionally use the same address for both roles."]),
    ]),
    h("ol", { class: "activation-progress", "aria-label": "Mandate activation progress" }, [
      h("li", { class: "activation-progress__done" }, [h("span", {}, ["01"]), h("strong", {}, ["Mandate deployed"]), h("small", {}, ["Verified public contracts"])]),
      h("li", { class: "activation-progress__done" }, [h("span", {}, ["02"]), h("strong", {}, ["Payment rule active"]), h("small", {}, ["Recipient and budget locked"])]),
      h("li", { class: "activation-progress__current" }, [h("span", {}, ["03"]), h("strong", {}, ["Deliver permission"]), h("small", {}, ["Choose the operator wallet now"])]),
      h("li", {}, [h("span", {}, ["04"]), h("strong", {}, ["Share operator link"]), h("small", {}, ["Available after successful receipt"])]),
    ]),
    h("div", { class: "delivery-layout" }, [
      h("section", { class: "delivery-form" }, [
        !issuerReady ? h("div", { class: "delivery-blocker" }, [h("strong", {}, ["Treasury wallet required"]), h("p", {}, ["Connect the wallet that created this mandate."])]) : null,
        h("div", { class: `delivery-step${!delivery.approvalBlock ? " delivery-step--active" : ""}` }, [
          h("span", {}, ["1"]),
          h("div", {}, [
            h("strong", {}, ["Operator wallet"]),
            h("p", {}, ["Enter the wallet that will receive the private pass."]),
            h("input", { type: "text", value: delivery.recipient || "", placeholder: "0x… operator wallet", oninput: { type: "delivery-recipient", value: "@" } }),
          ]),
        ]),
        h("div", { class: `delivery-step${delivery.approvalBlock && !delivery.completed ? " delivery-step--active" : ""}` }, [
          h("span", {}, ["2"]),
          h("div", {}, [
            h("strong", {}, ["Approve delivery"]),
            h("p", {}, ["Approve one pass and the separate STRK20 pool fee. Review both amounts in your wallet."]),
            h("button", { class: "btn btn--secondary", disabled: !issuerReady || !delivery.recipient || delivery.pending || delivery.approvalBlock ? "disabled" : null, onclick: { type: "mainnet-approve-delivery" } }, [delivery.pending === "approve" ? (delivery.confirming ? "Confirming onchain" : "Waiting for wallet") : delivery.approvalBlock ? "Approved" : delivery.pendingApprovalTransaction ? "Resume approval check" : "Approve one pass"]),
          ]),
        ]),
        h("div", { class: `delivery-step${delivery.completed ? " delivery-step--active" : ""}` }, [
          h("span", {}, ["3"]),
          h("div", {}, [
            h("strong", {}, ["Send private pass"]),
            h("p", {}, ["Your wallet creates the proof and sends the pass."]),
            h("button", { class: "btn btn--primary", disabled: !issuerReady || !delivery.approvalBlock || delivery.pending || delivery.completed ? "disabled" : null, onclick: { type: "mainnet-deliver-pass" } }, [delivery.pending === "deliver" ? (delivery.confirming ? "Confirming onchain" : "Waiting for wallet") : delivery.completed ? "Pass delivered" : delivery.pendingDeliveryTransaction ? "Resume delivery check" : "Send private pass"]),
          ]),
        ]),
        delivery.error ? h("div", { class: "delivery-blocker" }, [h("strong", {}, ["Action needs attention"]), h("p", {}, [delivery.error])]) : null,
        delivery.completed ? h("div", { class: "delivery-success" }, [
          h("strong", {}, ["Private pass delivered"]),
          h("p", {}, [delivery.shareCopied ? "Operator link copied." : "Copy the operator link and send it to the pass holder."]),
          delivery.shareUrl ? h("input", { class: "share-link-field", type: "text", readonly: "readonly", value: delivery.shareUrl, "aria-label": "Operator link" }) : null,
          h("button", { class: "btn btn--primary", onclick: { type: "dashboard-action", action: "share", token: record?.token } }, [delivery.shareCopied ? "Copy again" : "Copy operator link"]),
        ]) : null,
      ]),
      h("aside", { class: "mandate-sheet" }, [
        h("span", { class: "mandate-sheet__eyebrow" }, ["PASS CONTENT"]),
        h("h2", {}, [record?.tokenName || "Treasury permission"]),
        h("dl", {}, [
          h("div", {}, [h("dt", {}, ["Pays"]), h("dd", { class: "studio-mono" }, [short(record?.recipient)])]),
          h("div", {}, [h("dt", {}, ["Maximum"]), h("dd", {}, [`${formatTokenAmount(record?.maxFirstArg, record?.tokenSymbol)} ${record?.tokenSymbol || "STRK"}`])]),
          h("div", {}, [h("dt", {}, ["Operator wallet"]), h("dd", { class: "studio-mono" }, [short(delivery.recipient)])]),
        ]),
        delivery.completed ? h("button", { class: "btn btn--secondary", onclick: { type: "dashboard-action", action: "share", token: record?.token } }, ["Copy operator link"]) : null,
      ]),
    ]),
  ]);
}
