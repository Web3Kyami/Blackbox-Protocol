const h = (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] });

function step(number, title, body) {
  return h("li", { class: "home-step" }, [
    h("span", { class: "home-step__number" }, [number]),
    h("div", {}, [h("strong", {}, [title]), h("p", {}, [body])]),
  ]);
}

export function renderHome() {
  return h("section", { class: "studio-home", "data-testid": "studio-home" }, [
    h("div", { class: "home-hero" }, [
      h("div", { class: "home-hero__copy" }, [
        h("span", { class: "studio-kicker" }, ["PRIVATE TREASURY MANDATES"]),
        h("h1", {}, ["Give an operator payment authority. Keep your treasury key."]),
        h("p", { class: "home-hero__lede" }, [
          "Create one contract-enforced payment rule, privately deliver its permission, and let the operator request only what you approved.",
        ]),
        h("div", { class: "home-actions" }, [
          h("button", { class: "btn btn--primary btn--large", onclick: { type: "nav-create" } }, ["Create a mandate"]),
          h("button", { class: "btn btn--secondary btn--large", onclick: { type: "nav-dashboard" } }, ["Open treasury workspace"]),
        ]),
        h("p", { class: "home-proof" }, ["The operator cannot change the recipient, asset, cap, budget, or expiry."]),
      ]),
      h("aside", { class: "authority-visual", "aria-label": "Treasury permission flow" }, [
        h("div", { class: "authority-orbit authority-orbit--outer" }, []),
        h("div", { class: "authority-orbit authority-orbit--inner" }, []),
        h("div", { class: "authority-node authority-node--treasury" }, [h("small", {}, ["01 / ISSUER"]), h("strong", {}, ["Treasury"]), h("span", {}, ["Sets authority"])]),
        h("div", { class: "authority-node authority-node--pass" }, [h("small", {}, ["02 / PRIVATE"]), h("strong", {}, ["Pass"]), h("span", {}, ["Wallet-held"])]),
        h("div", { class: "authority-node authority-node--operator" }, [h("small", {}, ["03 / HOLDER"]), h("strong", {}, ["Operator"]), h("span", {}, ["Requests payment"])]),
        h("div", { class: "mandate-ticket" }, [
          h("div", { class: "mandate-ticket__serial" }, ["BBX / MANDATE / 001"]),
          h("strong", {}, ["20 STRK"]),
          h("span", {}, ["MAXIMUM / USE"]),
          h("div", { class: "mandate-ticket__rule" }, ["RECIPIENT LOCKED · EXPIRY ENFORCED"]),
        ]),
      ]),
    ]),
    h("section", { class: "role-flow" }, [
      h("header", {}, [
        h("span", { class: "studio-kicker" }, ["TWO PEOPLE, ONE ENFORCED RULE"]),
        h("h2", {}, ["The treasury sets authority. The operator uses it."]),
        h("p", {}, ["No administrator needs to manually approve the same payment again after the bounded authority is funded and delivered."]),
      ]),
      h("ol", { class: "home-steps" }, [
        step("01", "Treasury creates the rule", "Choose the recipient, STRK cap, total budget, pass behavior, and expiry."),
        step("02", "Treasury delivers one pass", "Send the private capability to the operator's compatible wallet and share the public policy link."),
        step("03", "Operator requests payment", "The wallet proves the pass; contracts reject anything outside the original rule."),
      ]),
    ]),
    h("section", { class: "home-boundary" }, [
      h("div", {}, [h("span", { class: "boundary-dot boundary-dot--public" }, []), h("strong", {}, ["Public onchain"]), h("p", {}, ["Treasury, asset, recipient, limits, expiry, pool deposit details, request, and payment result."])]),
      h("div", {}, [h("span", { class: "boundary-dot boundary-dot--private" }, []), h("strong", {}, ["Private in the wallet"]), h("p", {}, ["The capability note and proof material. Studio never stores them or claims to know the holder from public state."])]),
    ]),
    h("div", { class: "authority-marquee", "aria-hidden": "true" }, [
      h("span", {}, ["TREASURY KEY STAYS HOME  /  RECIPIENT LOCKED  /  LIMIT ENFORCED  /  CAPABILITY WALLET-HELD  /  "]),
      h("span", {}, ["TREASURY KEY STAYS HOME  /  RECIPIENT LOCKED  /  LIMIT ENFORCED  /  CAPABILITY WALLET-HELD  /  "]),
    ]),
  ]);
}
