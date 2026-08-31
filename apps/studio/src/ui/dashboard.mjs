// =============================================================================
// Studio dashboard — pure render layer (Phase 5)
// =============================================================================
//
// Renders the organization policy dashboard as a pure function of state:
//   renderDashboard(state) -> NodeTree   (same {tag, attrs, children} shape as
//   the wizard; mounted by mount.mjs).
//
// The dashboard receives ALREADY-DISCOVERED, REAL on-chain data in
// `state.index` (produced by org-policy-indexer.mjs). It never invents rows.
// If `state.index.count === 0`, it renders the empty state ("No mandates yet")
// and never displays sample data.
//
// Lifecycle states shown: active, expired, revoked, draft. Each record shows:
//   - state chip
//   - token symbol / name + address (explorer link)
//   - budget (allowance - total_spent = remaining), uses, expiry
//   - treasury / recipient / adapter / gatekeeper addresses (explorer links)
//   - register receipt link (explorer)
//   - public-data actions: Export and Share
//
// The buttons emit synthetic events the app layer handles. This module is
// render-only and never claims a private pass has been issued or revoked.
// =============================================================================

import { explorerAddress, explorerToken, explorerTx } from "../sdk/public-config.mjs";
import { formatTokenAmount } from "./format.mjs";

// Human-readable state labels + chip classes (UI_DIRECTION.md chip language).
export const STATE_LABEL = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  draft: "Draft",
};

function shortAddr(a) {
  if (!a) return "—";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function fmtExpiry(epochSec) {
  if (!epochSec) return "—";
  const d = new Date(epochSec * 1000);
  if (Number.isNaN(d.getTime())) return `unix ${epochSec}`;
  return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

// One policy card.
function policyCard(rec) {
  const actions = [];
  actions.push({
    tag: "button",
    attrs: {
      class: "studio-btn studio-btn--primary",
      "data-action": "view",
      "data-token": rec.token,
      onclick: { type: "open-mandate", token: rec.token },
    },
    children: ["Open mandate"],
  });
  if (rec.deliveryTransaction) actions.push({
    tag: "button",
    attrs: {
      class: "studio-btn studio-btn--ghost",
      "data-action": "share",
      "data-token": rec.token,
      onclick: { type: "dashboard-action", action: "share", token: rec.token },
    },
    children: ["Copy operator link"],
  });
  return {
    tag: "article",
    attrs: { class: `studio-card studio-card--${rec.state}`, "data-token": rec.token, "data-testid": "studio-policy-card" },
    children: [
      {
        tag: "header",
        attrs: { class: "studio-card__head" },
        children: [
          {
            tag: "h3",
            attrs: { class: "studio-card__title" },
            children: [
              `${rec.tokenName || "Treasury Mandate"} `,
              {
                tag: "span",
                attrs: { class: "studio-mono" },
                children: [shortAddr(rec.token)],
              },
            ],
          },
          {
            tag: "span",
            attrs: { class: `studio-chip studio-chip--${rec.state}` },
            children: [STATE_LABEL[rec.state] || rec.state],
          },
        ],
      },
      {
        tag: "dl",
        attrs: { class: "studio-meta" },
        children: [
          metaRow("Token", rec.tokenSymbol, explorerToken(rec.token)),
          metaRow("Remaining budget", `${formatTokenAmount(rec.remainingBudget, rec.tokenSymbol)} ${rec.tokenSymbol}`, null),
          metaRow("Used", `${rec.uses} use(s)`, null),
          metaRow("Expires", fmtExpiry(rec.expiresAt), null),
          metaRow("Treasury", shortAddr(rec.treasury), explorerAddress(rec.treasury)),
          metaRow("Recipient", shortAddr(rec.recipient), explorerAddress(rec.recipient)),
          metaRow("Adapter", shortAddr(rec.adapter), explorerAddress(rec.adapter)),
          metaRow("Gatekeeper", shortAddr(rec.gatekeeper), explorerAddress(rec.gatekeeper)),
          rec.links.registerTx
            ? metaRow("Register tx", "view", rec.links.registerTx)
            : metaRow("Register tx", "—", null),
        ],
      },
      {
        tag: "footer",
        attrs: { class: "studio-card__actions" },
        children: actions,
      },
    ],
  };
}

function metaRow(label, value, href) {
  const valueNode = href
    ? {
        tag: "a",
        attrs: { href, target: "_blank", rel: "noopener", class: "studio-link" },
        children: [value],
      }
    : { tag: "span", attrs: { class: "studio-mono" }, children: [value] };
  return {
    tag: "div",
    attrs: { class: "studio-meta__row" },
    children: [
      { tag: "dt", attrs: {}, children: [label] },
      { tag: "dd", attrs: {}, children: [valueNode] },
    ],
  };
}

// Summary bar: counts per state + total.
function summaryBar(index) {
  const b = index.byState || {};
  return {
    tag: "div",
    attrs: { class: "studio-summary" },
    children: [
      summaryStat("Total", index.count ?? 0),
      summaryStat("Active", b.active ?? 0),
      summaryStat("Expired", b.expired ?? 0),
      summaryStat("Revoked", b.revoked ?? 0),
      summaryStat("Draft", b.draft ?? 0),
    ],
  };
}

function summaryStat(label, n) {
  return {
    tag: "div",
    attrs: { class: "studio-summary__stat" },
    children: [
      { tag: "span", attrs: { class: "studio-summary__n" }, children: [String(n)] },
      { tag: "span", attrs: { class: "studio-summary__l" }, children: [label] },
    ],
  };
}

// Empty state — no fabricated rows, just a clear call to action.
function emptyState(org) {
  return {
    tag: "div",
    attrs: { class: "studio-empty" },
    children: [
      {
        tag: "h3",
        attrs: { class: "studio-empty__title" },
        children: ["No Treasury Mandates yet"],
      },
      {
        tag: "p",
        attrs: { class: "studio-empty__body" },
        children: [
          "This organization wallet",
          org ? { tag: "span", attrs: { class: "studio-mono" }, children: [" " + shortAddr(org) + " "] } : "",
          "has not registered any capability policies on the connected network. Create a mandate to see it here.",
        ],
      },
      {
        tag: "button",
        attrs: {
          class: "studio-btn studio-btn--primary",
          onclick: { type: "dashboard-new-mandate" },
        },
        children: ["Create a Treasury Mandate"],
      },
    ],
  };
}

// Loading / error states.
function statusState(kind, message) {
  return {
    tag: "div",
    attrs: { class: `studio-status studio-status--${kind}` },
    children: [
      { tag: "strong", attrs: {}, children: [kind === "loading" ? "Checking this wallet" : "Policy read unavailable"] },
      { tag: "p", attrs: {}, children: [message] },
      kind === "error"
        ? { tag: "button", attrs: { class: "studio-btn studio-btn--ghost", onclick: { type: "dashboard-retry" } }, children: ["Try again"] }
        : null,
    ].filter(Boolean),
  };
}

// Main render. state:
//   {
//     org: string|null,            // connected wallet address
//     index: {count, byState, records} | null,
//     loading: bool,
//     error: string|null,
//   }
export function renderDashboard(state = {}) {
  const { org, index, loading, error, notice } = state;

  const children = [
    {
      tag: "header",
      attrs: { class: "studio-dash__head" },
      children: [
        { tag: "div", attrs: {}, children: [
          { tag: "span", attrs: { class: "studio-kicker" }, children: ["TREASURY WORKSPACE"] },
          { tag: "h2", attrs: { class: "studio-dash__title" }, children: ["Treasury mandates"] },
          { tag: "p", attrs: { class: "studio-dash__lede" }, children: ["Create payment authority, deliver private passes, and monitor what the contracts have used."] },
        ] },
        org
          ? {
              tag: "span",
              attrs: { class: "studio-mono studio-dash__org" },
              children: [shortAddr(org)],
            }
          : { tag: "span", attrs: { class: "studio-mono" }, children: ["not connected"] },
        {
          tag: "button",
          attrs: {
            class: "studio-btn studio-btn--ghost studio-dash__new",
            onclick: { type: "dashboard-new-mandate" },
          },
          children: ["+ New mandate"],
        },
        {
          tag: "button",
          attrs: {
            class: "studio-btn studio-btn--ghost studio-dash__holder",
            onclick: { type: "dashboard-action", action: "holder" },
          },
          children: ["Use a permission"],
        },
      ],
    },
  ];

  if (loading) {
    children.push(statusState("loading", "Refreshing this wallet's mandates and payment usage."));
    return wrap(children);
  }
  if (error) {
    children.push(statusState("error", `Could not load policies: ${error}`));
    return wrap(children);
  }
  if (!org) {
    children.push(statusState("empty", "Connect a wallet to view its Treasury Mandates."));
    return wrap(children);
  }
  if (!index || index.count === 0) {
    children.push(emptyState(org));
    return wrap(children);
  }

  if (notice) {
    children.push({
      tag: "pre",
      attrs: { class: "studio-status studio-status--info", "data-testid": "dashboard-notice" },
      children: [notice],
    });
  }
  children.push(summaryBar(index));
  for (const rec of index.records) children.push(policyCard(rec));
  return wrap(children);
}

function wrap(children) {
  return { tag: "section", attrs: { class: "studio-dash", "data-testid": "studio-dashboard" }, children };
}

// Re-export link builders for the app layer / tests.
export { explorerAddress, explorerToken, explorerTx };
