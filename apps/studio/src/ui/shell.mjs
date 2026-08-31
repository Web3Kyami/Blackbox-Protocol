const h = (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] });

function navButton(index, label, event, active, extra = "") {
  return h("button", {
    class: `workspace-nav__item${active ? " workspace-nav__item--active" : ""} ${extra}`.trim(),
    onclick: event,
  }, [h("span", { class: "workspace-nav__index" }, [index]), h("span", {}, [label])]);
}

export function renderShell(content, state = {}) {
  const view = state.view || "home";
  const wallet = state.wallet?.address;
  return h("div", { class: `workspace workspace--${view}` }, [
    h("header", { class: "workspace-topbar" }, [
      h("button", { class: "workspace-brand", onclick: { type: "nav-home" }, "aria-label": "BlackBox Studio home" }, [
        h("span", { class: "workspace-brand__mark" }, []),
        h("span", {}, ["BlackBox Studio"]),
        h("small", {}, ["TREASURY PERMISSIONS"]),
      ]),
      h("div", { class: "workspace-topbar__context" }, [
        h("span", { class: "network-pill network-pill--mainnet" }, ["Starknet Mainnet"]),
        wallet
          ? h("button", { class: "wallet-pill", onclick: { type: "disconnect-wallet" } }, [`${wallet.slice(0, 6)}…${wallet.slice(-4)}`])
          : h("button", { class: "btn btn--secondary btn--small", onclick: { type: "connect-wallet-request" } }, ["Connect wallet"]),
      ]),
    ]),
    h("div", { class: "workspace-layout" }, [
      h("aside", { class: "workspace-nav", "aria-label": "Studio navigation" }, [
        h("span", { class: "workspace-nav__label" }, ["OPERATIONS / 2026"]),
        navButton("01", "Overview", { type: "nav-home" }, view === "home"),
        navButton("02", "Treasury mandates", { type: "nav-dashboard" }, ["dashboard", "mandate", "delivery"].includes(view)),
        navButton("03", "Create mandate", { type: "nav-create" }, view === "wizard", "workspace-nav__item--primary"),
        navButton("04", "Use a permission", { type: "nav-operator" }, view === "holder"),
        h("div", { class: "workspace-nav__privacy" }, [
          h("strong", {}, ["Privacy boundary"]),
          h("p", {}, ["The rule is public. The capability note stays in the holder's wallet."]),
        ]),
      ]),
      h("main", { class: "workspace-content" }, [content]),
    ]),
    state.walletPicker?.open
      ? h("div", { class: "studio-modal-backdrop" }, [
          h("section", { class: "studio-modal" }, [
            h("header", {}, [h("div", {}, [h("span", { class: "studio-kicker" }, ["CHOOSE WALLET"]), h("h2", {}, ["Connect to Mainnet"])]), h("button", { class: "text-button", onclick: { type: "wallet-picker-close" } }, ["Close"])]),
            ...(state.walletPicker.options || []).map((wallet, index) => h("button", { class: "wallet-choice", onclick: { type: "wallet-picker-select", index } }, [h("strong", {}, [wallet.name]), h("span", {}, ["Connect"])])),
            state.walletPicker.error ? h("p", { class: "delivery-blocker" }, [state.walletPicker.error]) : null,
            !(state.walletPicker.options || []).length ? h("p", {}, ["Unlock a compatible Starknet wallet, then reopen this list."]) : null,
          ]),
        ])
      : null,
  ]);
}
