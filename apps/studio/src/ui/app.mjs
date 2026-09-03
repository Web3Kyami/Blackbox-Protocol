// =============================================================================
// Studio entry — browser-only
// =============================================================================
//
// This is the page entry point. Loaded by `index.html` via
// `<script type="module" src="./src/ui/app.mjs"></script>`.
//
// Responsibilities:
//   1. Load the local Studio SDK copy (which itself copies the
//      upstream BlackBox SDK byte-for-byte, see apps/studio/src/sdk/
//      README banner).
//   2. Build the initial wizard state. The draft is empty; the
//      plan is null until the user reaches the review step.
//   3. Wire the dispatch loop: events flow from DOM -> reducer ->
//      new tree -> re-render.
//   4. When the user reaches the review step, compute the predicted
//      deployment plan via the SDK and push it into state.
//
// Phase 1 has no wallet, no chain call, and no submit. The Continue
// button on the final step is wired to a no-op reducer that returns
// the same state; the label explicitly says "awaiting wallet — Phase 2".
// =============================================================================

import { mount } from "./mount.mjs";
import {
  renderWizard,
  reduce,
  initialState,
  computePlan,
  publicConfiguration,
  calldataExport,
} from "./wizard.mjs";
import { renderDashboard } from "./dashboard.mjs";
import { renderHolder } from "./holder.mjs";
import { renderHome } from "./home.mjs";
import { renderShell } from "./shell.mjs";
import { renderMandateDetail } from "./mandate-detail.mjs";
import { renderPassDelivery } from "./pass-delivery.mjs";
import { readRuntimeNetworkConfig } from "../sdk/public-config.mjs";

// Phase 5 — map app state into the dashboard render shape.
function dashboardState(s) {
  return {
    org: s.wallet?.address || null,
    index: s.dashboard ? s.dashboard.index : null,
    loading: s.dashboard ? s.dashboard.loading : false,
    error: s.dashboard ? s.dashboard.error : null,
    notice: s.dashboard ? s.dashboard.notice : null,
  };
}

// Phase 4 — module-scope state references so runDeployLoop
// (defined at module scope for the same reason) can read &
// mutate them. These are assigned by boot() and never
// referenced before that.
let appState = null;
let appMount = null;
let appReRender = null;
let availableWallets = [];
let walletDiscovery = null;
let mainnetSession = null;
const MAINNET_PROGRESS_KEY = "blackbox.studio.mainnet.deployment.v1";
const MAINNET_MANDATES_KEY = "blackbox.studio.mainnet.mandates.v1";
const MAINNET_DELIVERY_PREFIX = "blackbox.studio.mainnet.delivery.v1:";
const MAINNET_HOLDER_PREFIX = "blackbox.studio.mainnet.holder.v1:";

function renderPreservingActiveField(state) {
  const active = document.activeElement;
  const fieldName = active?.getAttribute?.("name") || "";
  const selectionStart = typeof active?.selectionStart === "number" ? active.selectionStart : null;
  const selectionEnd = typeof active?.selectionEnd === "number" ? active.selectionEnd : null;
  appMount.setTree(appReRender(state));
  if (!fieldName) return;
  const restored = Array.from(document.getElementsByName(fieldName)).find((node) => node.closest("#studio"));
  if (!restored) return;
  restored.focus({ preventScroll: true });
  if (selectionStart != null && typeof restored.setSelectionRange === "function") {
    restored.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
  }
}

function readMainnetProgress() {
  try { return JSON.parse(localStorage.getItem(MAINNET_PROGRESS_KEY) || "{}"); } catch { return {}; }
}

function saveMainnetProgress(progress) {
  try { localStorage.setItem(MAINNET_PROGRESS_KEY, JSON.stringify(progress || {})); } catch {}
}

async function refreshHolderRecord(token, networkConfig, fallback) {
  try {
    const { loadHolderPolicy } = await import("../sdk/holder-reads.mjs");
    return await loadHolderPolicy(token, { rpcUrl: networkConfig?.rpcUrl });
  } catch {
    // A confirmed receipt is stronger evidence than a transient follow-up RPC
    // read. Keep the confirmed screen available and refresh again later.
    return fallback;
  }
}

async function preloadHolderPolicy(token, networkConfig) {
  if (!token) return;
  try {
    const { loadHolderPolicy } = await import("../sdk/holder-reads.mjs");
    const record = await loadHolderPolicy(token, { rpcUrl: networkConfig?.rpcUrl });
    if (appState?.view !== "holder" || appState.holder?.token !== token) return;
    appState = {
      ...appState,
      holder: { ...appState.holder, record, view: "input", error: null, permissionChecked: false },
    };
    appMount?.setTree(appReRender(appState));
  } catch {
    // The explicit permission check reports read failures. Prefetch stays
    // silent so a temporary endpoint issue does not replace the usable link.
  }
}

function publicDraftSnapshot(draft = {}) {
  return {
    treasury: draft.treasury || "", asset: draft.asset || "STRK",
    recipient: draft.recipient || "", cap: draft.cap || "",
    budget: draft.budget || "", supply: draft.supply || "1",
    mode: draft.mode || null, expiry: draft.expiry || "",
  };
}

function deliveryKey(token) {
  return `${MAINNET_DELIVERY_PREFIX}${String(token || "").toLowerCase()}`;
}

function readDelivery(token) {
  if (!token) return { recipient: "" };
  try { return JSON.parse(localStorage.getItem(deliveryKey(token)) || "{\"recipient\":\"\"}"); }
  catch { return { recipient: "" }; }
}

function saveDelivery(token, delivery) {
  if (!token) return;
  const safe = {
    recipient: delivery?.recipient || "",
    approvalBlock: delivery?.approvalBlock || null,
    approvalTransaction: delivery?.approvalTransaction || null,
    fee: delivery?.fee || null,
    completed: delivery?.completed === true,
    deliveryTransaction: delivery?.deliveryTransaction || null,
    pendingApprovalTransaction: delivery?.pendingApprovalTransaction || null,
    pendingDeliveryTransaction: delivery?.pendingDeliveryTransaction || null,
  };
  try { localStorage.setItem(deliveryKey(token), JSON.stringify(safe)); } catch {}
}

function readHolderProgress(token) {
  try { return JSON.parse(localStorage.getItem(`${MAINNET_HOLDER_PREFIX}${String(token || "").toLowerCase()}`) || "{}"); }
  catch { return {}; }
}

function saveHolderProgress(token, progress) {
  try { localStorage.setItem(`${MAINNET_HOLDER_PREFIX}${String(token || "").toLowerCase()}`, JSON.stringify(progress || {})); } catch {}
}

function newMandateProgress(current = {}) {
  if (!current.setupTransaction) return current;
  try { localStorage.removeItem(MAINNET_PROGRESS_KEY); } catch {}
  return {};
}

function readSavedMandates() {
  try {
    const value = JSON.parse(localStorage.getItem(MAINNET_MANDATES_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function saveMandate(record) {
  const records = readSavedMandates().filter((item) => item?.token !== record?.token);
  records.unshift(record);
  try { localStorage.setItem(MAINNET_MANDATES_KEY, JSON.stringify(records)); } catch {}
}

function updateSavedMandate(token, patch) {
  const records = readSavedMandates();
  const index = records.findIndex((item) => item?.token === token);
  if (index < 0) return;
  records[index] = { ...records[index], ...patch };
  try { localStorage.setItem(MAINNET_MANDATES_KEY, JSON.stringify(records)); } catch {}
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(field);
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function friendlyError(error, fallback = "The wallet could not complete this action.") {
  const raw = error?.message || String(error || "");
  if (/reject|cancel|denied/i.test(raw)) return "Request cancelled. Nothing was sent.";
  if (/insufficient|balance|fee/i.test(raw)) return "This wallet does not have enough STRK to cover the amount and network fee.";
  return raw || fallback;
}

function mandateIndex(records) {
  const byState = { active: 0, expired: 0, revoked: 0, draft: 0 };
  for (const record of records) byState[record.state] = (byState[record.state] || 0) + 1;
  return { count: records.length, byState, records };
}

function updateWalletLabel(wallet) {
  const label = document.querySelector("[data-testid=topbar-wallet]");
  if (!label) return;
  const address = wallet?.address;
  label.textContent = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "Not connected";
}

// Phase 5 — load the connected org's REAL on-chain policies. Read-only RPC.
// Updates appState.dashboard and re-renders. Never fabricates rows.
async function loadDashboard(org, networkConfig) {
  if (!org) return;
  const stored = readSavedMandates().filter((record) => String(record.treasury).toLowerCase() === String(org).toLowerCase());
  try {
    const { indexOrgPolicies } = await import("../sdk/org-policy-indexer.mjs");
    const result = await Promise.race([
      indexOrgPolicies(org, networkConfig || {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error("The network did not answer within 12 seconds. Check the network and try again.")), 12000)),
    ]);
    if (!appState) return;
    const merged = (result.records || []).map((record) => {
      const local = stored.find((item) => item.token === record.token);
      return local
        ? { ...local, ...record, deliveryTransaction: local.deliveryTransaction || null, links: { ...(local.links || {}), ...(record.links || {}) } }
        : record;
    });
    appState = { ...appState, dashboard: { loading: false, error: null, index: mandateIndex(merged) } };
    if (appState.view === "dashboard") appMount.setTree(appReRender(appState));
  } catch (err) {
    if (!appState) return;
    const msg = err?.message || String(err);
    appState = { ...appState, dashboard: { loading: false, error: msg, index: null } };
    if (appState.view === "dashboard") appMount.setTree(appReRender(appState));
  }
}
// Boot. `document.currentScript.parentElement` is the <body> in our
// index.html. We expect a single child with id="studio" as the
// mount target.
function boot() {
  const target = document.getElementById("studio");
  if (!target) {
    // Surface clearly. In Phase 2, when we have telemetry, this
    // becomes a real error. For now, log and stop.
    console.error("Studio: mount target #studio not found");
    return;
  }

  const savedProgress = readMainnetProgress();
  let state = initialState({
    networkConfig: readRuntimeNetworkConfig(),
    draft: savedProgress?.publicDraft || undefined,
  });
  // Phase 5 — view switch: "wizard" (default) or "dashboard".
  const url = new URL(window.location.href);
  const sharedPolicy = url.searchParams.get("policy");
  state = {
    ...state,
    view: sharedPolicy ? "holder" : "home",
    dashboard: { loading: false, error: null, index: null, notice: null },
    holder: sharedPolicy ? { token: sharedPolicy, record: null, error: null, view: "input" } : null,
    mainnet: { deployment: savedProgress, pending: null, error: null, lastTransaction: null },
    walletPicker: { open: false, options: [] },
  };
  // Phase 4 — expose the live references to runDeployLoop
  // (which lives at module scope so it can be called
  // asynchronously without an explicit state argument).
  appState = state;
  updateWalletLabel(state.wallet);
  const root = document.getElementById("studio");

  function reRender(s) {
    let content;
    if (s.view === "home") content = renderHome(s);
    else if (s.view === "dashboard") content = renderDashboard(dashboardState(s));
    else if (s.view === "mandate") content = renderMandateDetail(s);
    else if (s.view === "delivery") content = renderPassDelivery(s);
    else if (s.view === "holder") content = renderHolder(s);
    else content = renderWizard(s);
    return renderShell(content, s);
  }
  appReRender = reRender;
  appMount = mount(reRender(state), root, {
    onEvent: async (event) => {
      // Async dashboard reads update the module-level state. Always start from
      // that current snapshot instead of the render that originally attached
      // this listener.
      state = appState || state;
      // Phase 2: wallet connection. The "connect-wallet-request"
      // event is dispatched by the Treasury step's connect button.
      // We handle it here (browser-only) because it needs
      // window.starknet. This is a *connection request only* —
      // enable() does not send any transaction and performs no
      // Mainnet write. Per AGENTS.md, no Mainnet writes happen
      // without explicit per-action approval; this is not one.
      if (event.type === "connect-wallet-request") {
        state = { ...state, walletPicker: { open: true, error: null, options: availableWallets.map((wallet) => ({ name: wallet.name })) } };
        appState = state;
        appMount.setTree(reRender(state));
        return;
      }

      if (event.type === "wallet-picker-close") {
        state = { ...state, walletPicker: { ...(state.walletPicker || {}), open: false } };
        appState = state; appMount.setTree(reRender(state)); return;
      }

      if (event.type === "wallet-picker-select") {
        try {
          const wallet = availableWallets[Number(event.index)];
          if (!wallet) throw new Error("Choose an available Starknet wallet.");
          const { connectMainnetWallet } = await import("../sdk/mainnet-actions.mjs");
          mainnetSession = await connectMainnetWallet(wallet);
          const { address, chainId } = mainnetSession;
          state = reduce(state, { type: "connect-wallet", address, chainId });
          state = { ...state, walletPicker: { open: false, options: [] } };
          if (state.view === "holder" && ["no-pass", "error"].includes(state.holder?.view)) {
            state = { ...state, holder: { ...(state.holder || {}), view: "input", record: null, permissionChecked: false, error: null } };
          }
          if (state.view === "dashboard") {
            state = { ...state, dashboard: { loading: true, error: null, index: null, notice: null } };
          }
          appState = state;
          updateWalletLabel(state.wallet);
          appMount.setTree(reRender(state));
          if (state.view === "dashboard") loadDashboard(address, state.networkConfig);
        } catch (err) {
          console.error("Studio: wallet connection failed:", err?.message || err);
          state = reduce(state, { type: "connect-wallet", address: null });
          state = { ...state, walletPicker: { open: true, options: availableWallets.map((wallet) => ({ name: wallet.name })), error: friendlyError(err) } };
        }
        appMount.setTree(reRender(state));
        updateWalletLabel(state.wallet);
        return;
      }

      if (event.type === "disconnect-wallet") {
        mainnetSession = null;
        state = reduce(state, event);
        if (state.view === "holder") {
          state = { ...state, holder: { token: state.holder?.token || "", record: null, error: null, view: "input", permissionChecked: false } };
        }
        appState = state; updateWalletLabel(null); appMount.setTree(reRender(state)); return;
      }

      if (event.type === "nav-home") {
        state = { ...state, view: "home" };
        appState = state; appMount.setTree(reRender(state)); return;
      }
      if (event.type === "nav-create") {
        const deployment = newMandateProgress(state.mainnet?.deployment);
        const resumable = deployment?.gatekeeper && !deployment?.setupTransaction && deployment?.publicDraft;
        state = {
          ...state, view: "wizard", step: resumable ? 4 : 0, plan: null, planError: null,
          acknowledgedBoundary: resumable ? true : false,
          draft: resumable ? { ...state.draft, ...deployment.publicDraft, treasury: state.wallet?.address || deployment.publicDraft.treasury } : { ...initialState().draft, treasury: state.wallet?.address || "" },
          mainnet: { ...(state.mainnet || {}), deployment, error: null, lastTransaction: null },
        };
        appState = state; appMount.setTree(reRender(state)); return;
      }
      if (event.type === "nav-dashboard") {
        state = { ...state, view: "dashboard", dashboard: { ...(state.dashboard || {}), loading: !!state.wallet?.address, error: null, notice: null } };
        appState = state; appMount.setTree(reRender(state));
        if (state.wallet?.address) loadDashboard(state.wallet.address, state.networkConfig);
        return;
      }
      if (event.type === "dashboard-retry") {
        if (!state.wallet?.address) return;
        state = { ...state, dashboard: { ...(state.dashboard || {}), loading: true, error: null, index: null, notice: null } };
        appState = state; appMount.setTree(reRender(state));
        loadDashboard(state.wallet.address, state.networkConfig);
        return;
      }
      if (event.type === "nav-operator") {
        state = { ...state, view: "holder", holder: { token: "", record: null, error: null, view: "input" } };
        appState = state; appMount.setTree(reRender(state)); return;
      }
      if (event.type === "open-mandate") {
        const record = state.dashboard?.index?.records?.find((item) => item.token === event.token) || state.mandate;
        state = { ...state, view: "mandate", mandate: record || null };
        appState = state; appMount.setTree(reRender(state)); return;
      }
      if (event.type === "open-delivery") {
        const record = state.dashboard?.index?.records?.find((item) => item.token === event.token) || state.mandate;
        state = { ...state, view: "delivery", mandate: record || null, delivery: readDelivery(record?.token) };
        appState = state; appMount.setTree(reRender(state));
        if (mainnetSession?.account && record?.token && !state.delivery?.completed) {
          try {
            const { deliveryApprovalStatus, findPrivatePassDelivery } = await import("../sdk/mainnet-actions.mjs");
            const completed = await findPrivatePassDelivery(mainnetSession.address, record.token);
            if (completed && appState?.view === "delivery" && appState?.mandate?.token === record.token) {
              state = {
                ...appState,
                mandate: { ...appState.mandate, deliveryTransaction: completed.transactionHash },
                delivery: {
                  ...(appState.delivery || {}),
                  pending: null,
                  confirming: false,
                  pendingDeliveryTransaction: null,
                  completed: true,
                  deliveryTransaction: completed.transactionHash,
                  error: null,
                },
              };
              saveDelivery(record.token, state.delivery);
              updateSavedMandate(record.token, { deliveryTransaction: completed.transactionHash });
              appState = state;
              appMount.setTree(reRender(state));
              return;
            }
            const approval = await deliveryApprovalStatus(mainnetSession.address, record.token);
            if (appState?.view === "delivery" && appState?.mandate?.token === record.token) {
              const recovered = approval.approved
                ? {
                    approvalBlock: appState.delivery?.approvalBlock || approval.observedAtBlock,
                    approvalTransaction: appState.delivery?.approvalTransaction || "onchain-allowance",
                    fee: approval.fee,
                    recoveredApproval: true,
                    error: null,
                  }
                : {
                    approvalBlock: null,
                    approvalTransaction: null,
                    fee: approval.fee,
                    recoveredApproval: false,
                    error: appState.delivery?.approvalBlock
                      ? "The required STRK20 fee allowance is not available. Approve delivery before sending the pass."
                      : appState.delivery?.error || null,
                  };
              state = {
                ...appState,
                delivery: {
                  ...(appState.delivery || {}),
                  ...recovered,
                },
              };
              saveDelivery(record.token, state.delivery);
              appState = state;
              appMount.setTree(reRender(state));
            }
          } catch {
            // The normal approval button remains available if the read-only
            // recovery check cannot reach Mainnet.
          }
        }
        return;
      }
      if (event.type === "delivery-recipient") {
        state = { ...state, delivery: { ...(state.delivery || {}), recipient: event.value } };
        appState = state;
        renderPreservingActiveField(state);
        return;
      }

      if (event.type === "mainnet-deploy-next") {
        if (!mainnetSession?.account || !state.plan) return;
        state = { ...state, mainnet: { ...(state.mainnet || {}), pending: "deploy", error: null } };
        appState = state; appMount.setTree(reRender(state));
        try {
          const { deployNext, deploymentStage } = await import("../sdk/mainnet-actions.mjs");
          const onProgress = (pendingProgress) => {
            const deployment = { ...pendingProgress, publicDraft: publicDraftSnapshot(state.draft) };
            saveMainnetProgress(deployment);
            state = { ...state, mainnet: { ...state.mainnet, deployment, pending: "confirming", lastTransaction: pendingProgress.pendingTransaction } };
            appState = state; appMount.setTree(reRender(state));
          };
          const deployment = {
            ...(await deployNext(mainnetSession.account, state.draft, state.plan, state.mainnet.deployment || {}, onProgress)),
            publicDraft: publicDraftSnapshot(state.draft),
          };
          saveMainnetProgress(deployment);
          const lastTransaction = deployment.setupTransaction || deployment.tokenTransaction || deployment.adapterTransaction || deployment.gatekeeperTransaction;
          state = { ...state, mainnet: { ...state.mainnet, deployment, pending: null, error: null, lastTransaction } };
          if (deploymentStage(deployment) === "complete") {
            const record = {
              state: "active", token: deployment.token, tokenName: state.plan.capabilityName,
              tokenSymbol: "STRK", recipient: state.draft.recipient,
              maxFirstArg: state.plan.maxAmount, remainingBudget: state.plan.treasuryAllowance,
              reusable: state.draft.mode === "reusable", expiresAt: Number(state.plan.expiresAt), uses: 0,
              passSupply: Number(state.plan.supply || 1),
              gatekeeper: deployment.gatekeeper, adapter: deployment.adapter,
              treasury: state.draft.treasury, asset: state.networkConfig.asset,
              links: { registerTx: `https://voyager.online/tx/${deployment.setupTransaction}` },
            };
            saveMandate(record);
            state = { ...state, mandate: record, view: "mandate", networkConfig: { ...state.networkConfig, network: "mainnet", gatekeeper: deployment.gatekeeper, adapter: deployment.adapter } };
          }
        } catch (error) {
          state = { ...state, mainnet: { ...state.mainnet, pending: null, error: error?.message || String(error) } };
        }
        appState = state; appMount.setTree(reRender(state)); return;
      }

      if (event.type === "mainnet-approve-delivery") {
        if (!mainnetSession?.account || !state.mandate?.token) return;
        state = { ...state, delivery: { ...(state.delivery || {}), pending: "approve", error: null } };
        appState = state; appMount.setTree(reRender(state));
        try {
          const { approvePassDelivery, normalizeStarknetAddress } = await import("../sdk/mainnet-actions.mjs");
          normalizeStarknetAddress(state.delivery.recipient);
          const receipt = await approvePassDelivery(mainnetSession.account, state.mandate.token, 1n, state.delivery, (pending) => {
            state = { ...state, delivery: { ...state.delivery, ...pending, pending: "approve", confirming: true } };
            saveDelivery(state.mandate.token, state.delivery);
            appState = state; appMount.setTree(reRender(state));
          });
          state = { ...state, delivery: { ...state.delivery, pending: null, confirming: false, pendingApprovalTransaction: null, approvalBlock: receipt.blockNumber, approvalTransaction: receipt.transactionHash, fee: receipt.fee } };
          saveDelivery(state.mandate.token, state.delivery);
        } catch (error) {
          state = { ...state, delivery: { ...state.delivery, pending: null, confirming: false, error: friendlyError(error) } };
        }
        appState = state; appMount.setTree(reRender(state)); return;
      }

      if (event.type === "mainnet-deliver-pass") {
        if (!mainnetSession?.account || !state.delivery?.approvalBlock) return;
        state = { ...state, delivery: { ...state.delivery, pending: "deliver", error: null } };
        appState = state; appMount.setTree(reRender(state));
        try {
          const { deliverPrivatePass } = await import("../sdk/mainnet-actions.mjs");
          const receipt = await deliverPrivatePass(mainnetSession.account, state.mandate.token, state.delivery.recipient, state.delivery.approvalBlock, 1n, state.delivery, (pending) => {
            state = { ...state, delivery: { ...state.delivery, ...pending, pending: "deliver", confirming: true } };
            saveDelivery(state.mandate.token, state.delivery);
            appState = state; appMount.setTree(reRender(state));
          });
          state = { ...state, delivery: { ...state.delivery, pending: null, confirming: false, pendingDeliveryTransaction: null, completed: true, deliveryTransaction: receipt.transactionHash } };
          saveDelivery(state.mandate.token, state.delivery);
          updateSavedMandate(state.mandate.token, { deliveryTransaction: receipt.transactionHash });
          state = { ...state, mandate: { ...state.mandate, deliveryTransaction: receipt.transactionHash } };
        } catch (error) {
          state = { ...state, delivery: { ...state.delivery, pending: null, confirming: false, error: friendlyError(error) } };
        }
        appState = state; appMount.setTree(reRender(state)); return;
      }

      // Phase 3 — copy-export: writes the public configuration JSON
      // or the SDK calldata snippet to the browser clipboard. The
      // wizard already has the text in the rail; this branch is the
      // browser-only glue between the click and navigator.clipboard.
      // No signing, no chain call, no Mainnet write.
      if (event.type === "copy-export") {
        try {
          const text =
            event.target === "config"
              ? JSON.stringify(publicConfiguration(state.draft, state.plan, state.networkConfig), null, 2)
              : calldataExport(state.plan) || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            // Fallback for non-secure-context environments.
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "absolute";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
        } catch (err) {
          console.error("Studio: copy to clipboard failed:", err?.message || err);
        }
        // The reducer is a no-op for copy-export, so we still
        // re-render in case future work adds visual feedback.
        appMount.setTree(reRender(state));
        return;
      }

      // Start a fresh mandate configuration. This does not register a policy,
      // mint a pass, or send a transaction.
      if (event.type === "dashboard-new-mandate") {
        if (state.mainnet?.deployment?.gatekeeper && !state.mainnet.deployment.setupTransaction) {
          state = { ...state, view: "wizard", step: 5, mainnet: { ...state.mainnet, error: "Finish the current mandate deployment before starting another one." } };
          appState = state; appMount.setTree(reRender(state)); return;
        }
        state = {
          ...state,
          view: "wizard",
          step: 0,
          plan: null,
          planError: null,
          acknowledgedBoundary: false,
          draft: { ...initialState().draft, treasury: state.wallet?.address || "" },
          mainnet: { ...(state.mainnet || {}), deployment: newMandateProgress(state.mainnet?.deployment), error: null, lastTransaction: null },
        };
        appState = state;
        appMount.setTree(reRender(state));
        return;
      }

      // Phase 7 — holder experience. Load a policy from a shared-link token
      // (read-only), then exercise it via the real Wallet API action builder.
      if (event.type === "holder-token") {
        const h0 = state.holder || {};
        state = { ...state, holder: { ...h0, token: event.value, error: null } };
        appState = state;
        appMount.setTree(reRender(state));
        return;
      }
      if (event.type === "holder-amount") {
        const h0 = state.holder || {};
        const iss = h0.issuance || {};
        state = { ...state, holder: { ...h0, issuance: { ...iss, error: null, fields: { ...(iss.fields || {}), amount: event.value } } } };
        appState = state;
        renderPreservingActiveField(state);
        return;
      }
      if (event.type === "holder-check") {
        const h0 = state.holder || {};
        const token = (h0.token || "").trim();
        if (!mainnetSession?.account) {
          state = { ...state, holder: { ...h0, view: "no-pass", record: null, permissionChecked: false, error: "Connect the wallet that received the private pass." } };
          appState = state; appMount.setTree(reRender(state)); return;
        }
        if (!token) {
          state = { ...state, holder: { ...h0, view: "error", error: "This operator link is missing its mandate address." } };
          appState = state; appMount.setTree(reRender(state)); return;
        }
        state = { ...state, holder: { ...h0, view: "checking", permissionChecked: false, error: null } };
        appState = state; appMount.setTree(reRender(state));
        let record = h0.record;
        try {
          if (!record) {
            const { loadHolderPolicy } = await import("../sdk/holder-reads.mjs");
            record = await loadHolderPolicy(token, { rpcUrl: state.networkConfig?.rpcUrl });
          }
        } catch (error) {
          state = { ...state, holder: { ...h0, record: null, permissionChecked: false, view: "error", error: friendlyError(error, "The public mandate could not be loaded. Try again.") } };
          appState = state; appMount.setTree(reRender(state)); return;
        }
        if (record.state !== "active") {
          state = { ...state, holder: { ...h0, record: null, permissionChecked: false, view: "error", error: `This permission is ${record.state} and cannot be used.` } };
          appState = state; appMount.setTree(reRender(state)); return;
        }
        try {
          const [{ buildHolderAction }, { prepareHolderProof, exerciseHolderPass, atomicToStrk }] = await Promise.all([
            import("../sdk/holder-action.mjs"), import("../sdk/mainnet-actions.mjs"),
          ]);
          const max = BigInt(record.maxFirstArg);
          const remaining = BigInt(record.remainingBudget);
          const checkAmount = max < remaining ? max : remaining;
          const holderProgress = readHolderProgress(record.token);
          const recoveredAmount = BigInt(holderProgress.amount || checkAmount);
          if (holderProgress.completedTransaction) {
            const confirmed = await exerciseHolderPass(mainnetSession.account, [], holderProgress);
            const refreshedRecord = await refreshHolderRecord(record.token, state.networkConfig, record);
            state = { ...state, holder: { ...h0, record: refreshedRecord, permissionChecked: true, view: "complete", error: null, issuance: { fields: { amount: atomicToStrk(recoveredAmount) }, receipt: { kind: "real", txHash: confirmed.transactionHash, recovered: true } } } };
            appState = state; appMount.setTree(reRender(state)); return;
          }
          if (holderProgress.pendingTransaction) {
            state = { ...state, holder: { ...h0, view: "confirming", record, permissionChecked: true, error: null, issuance: { fields: { amount: atomicToStrk(recoveredAmount) }, pendingTransaction: holderProgress.pendingTransaction } } };
            appState = state; appMount.setTree(reRender(state));
            try {
              const confirmed = await exerciseHolderPass(mainnetSession.account, [], holderProgress);
              saveHolderProgress(record.token, { completedTransaction: confirmed.transactionHash, amount: recoveredAmount.toString() });
              const refreshedRecord = await refreshHolderRecord(record.token, state.networkConfig, record);
              state = { ...state, holder: { ...h0, record: refreshedRecord, permissionChecked: true, view: "complete", error: null, issuance: { fields: { amount: atomicToStrk(recoveredAmount) }, receipt: { kind: "real", txHash: confirmed.transactionHash, recovered: true } } } };
            } catch (error) {
              state = { ...state, holder: { ...h0, record, permissionChecked: true, view: "error", error: friendlyError(error), issuance: { fields: { amount: atomicToStrk(recoveredAmount) }, pendingTransaction: holderProgress.pendingTransaction, error: friendlyError(error) } } };
            }
            appState = state; appMount.setTree(reRender(state)); return;
          }
          if (checkAmount <= 0n) throw new Error("This mandate has no remaining payment budget.");
          const actions = buildHolderAction(record, [checkAmount.toString()], mainnetSession.address);
          await prepareHolderProof(mainnetSession.account, actions);
          state = { ...state, holder: { ...h0, record, permissionChecked: true, view: "loaded", error: null, issuance: { fields: { amount: atomicToStrk(checkAmount) }, error: null } } };
        } catch (error) {
          state = { ...state, holder: { ...h0, record: null, permissionChecked: false, view: "no-pass", error: "This wallet cannot prove it holds the private pass. Switch to the wallet that received it." } };
        }
        appState = state; appMount.setTree(reRender(state)); return;
      }
      if (event.type === "holder-exercise") {
        const h0 = state.holder || {};
        const record = h0.record;
        if (!record) return;
        const iss = h0.issuance || { fields: {} };
        const amount = iss.fields?.amount || "0.01";
        try {
          if (!mainnetSession?.account || !h0.permissionChecked) throw new Error("Check this wallet's permission first.");
          const [{ buildHolderAction }, { exerciseHolderPass, validateHolderAmount }] = await Promise.all([
            import("../sdk/holder-action.mjs"), import("../sdk/mainnet-actions.mjs"),
          ]);
          const atomic = validateHolderAmount(amount, record);
          const action = buildHolderAction(record, [atomic], mainnetSession.address);
          const holderProgress = readHolderProgress(record.token);
          const confirmed = await exerciseHolderPass(mainnetSession.account, action, holderProgress, (pending) => {
            saveHolderProgress(record.token, { ...pending, amount: atomic.toString() });
            state = { ...state, holder: { ...h0, view: "confirming", record, permissionChecked: true, issuance: { ...iss, pendingTransaction: pending.pendingTransaction } } };
            appState = state; appMount.setTree(reRender(state));
          });
          saveHolderProgress(record.token, { completedTransaction: confirmed.transactionHash, amount: atomic.toString() });
          const receipt = { kind: "real", txHash: confirmed.transactionHash, confirmation: confirmed };
          const refreshedRecord = await refreshHolderRecord(record.token, state.networkConfig, record);
          state = { ...state, holder: { ...h0, record: refreshedRecord, view: "complete", issuance: { ...iss, receipt, error: null } } };
          appState = state;
        } catch (err) {
          state = { ...state, holder: { ...h0, record, permissionChecked: true, view: "loaded", error: null, issuance: { ...iss, error: err?.message || String(err) } } };
          appState = state;
        }
        appMount.setTree(reRender(state));
        return;
      }
      if (event.type === "holder-back") {
        state = { ...state, view: "home", holder: null };
        appState = state;
        appMount.setTree(reRender(state));
        return;
      }

      // Dashboard actions are deliberately public-data-only. A policy
      // registration is not private-pass delivery, and no verified pass
      // issuance/revocation product flow exists in this Studio build.
      if (event.type === "dashboard-action") {
        const { action, token } = event;
        if (action === "holder") {
          state = { ...state, view: "holder", holder: { token: "", record: null, error: null, view: "input" } };
          appState = state;
          appMount.setTree(reRender(state));
          return;
        }
        const record = state.dashboard?.index?.records?.find((item) => item.token === token)
          || (state.mandate?.token === token ? state.mandate : null);
        if (!record) return;
        if (action === "share") {
          const shareUrl = new URL(window.location.href);
          shareUrl.search = "";
          shareUrl.searchParams.set("policy", token);
          const url = shareUrl.toString();
          try {
            await copyText(url);
            state = { ...state, dashboard: { ...state.dashboard, notice: "Operator link copied." }, delivery: state.view === "delivery" ? { ...(state.delivery || {}), shareCopied: true, shareUrl: url } : state.delivery };
          } catch {
            state = { ...state, dashboard: { ...state.dashboard, notice: null }, delivery: state.view === "delivery" ? { ...(state.delivery || {}), shareCopied: false, shareUrl: url, error: "Clipboard access is unavailable. Copy the link shown below." } : state.delivery };
          }
        } else if (action === "export") {
          const { policyExport } = await import("../sdk/holder-reads.mjs");
          state = { ...state, dashboard: { ...state.dashboard, notice: JSON.stringify(policyExport(record), null, 2) } };
        }
        appState = state;
        appMount.setTree(reRender(state));
        return;
      }

      state = reduce(state, event);
      if (event.type === "update-draft") {
        // Draft edits change both the summary and whether Continue is enabled.
        // Re-render immediately, then restore the active field and caret so the
        // form stays responsive without interrupting typing.
        appState = state;
        renderPreservingActiveField(state);
        return;
      }
      // When the user reaches the review step and we don't yet have
      // a plan, compute one. This is a *real* call to the Studio
      // SDK (which is the upstream SDK). With an empty draft the
      // computePlan helper returns an error plan; that is the
      // intended behavior — the right rail surfaces the error and
      // Continue stays disabled until the user fills in a treasury.
      if (
        state.step === 5 &&
        state.plan == null &&
        state.planError == null
      ) {
        const sdk = await import("../sdk/blackbox-capability-sdk.mjs");
        const result = computePlan(state.draft, sdk, state.networkConfig);
        if (result.ok) {
          state = { ...state, plan: result.plan, planError: null };
        } else {
          state = { ...state, plan: null, planError: result.error };
        }
      }
      appMount.setTree(reRender(state));
      appState = state;
    },
  });
  import("../sdk/mainnet-actions.mjs").then(({ discoverWallets }) => {
    const found = discoverWallets((wallets) => {
      availableWallets = wallets;
      if (appState?.walletPicker?.open) {
        appState = { ...appState, walletPicker: { open: true, options: wallets.map((wallet) => ({ name: wallet.name })) } };
        appMount?.setTree(appReRender(appState));
      }
    });
    walletDiscovery = found.store;
    availableWallets = found.wallets;
  }).catch(() => { availableWallets = []; });
  if (sharedPolicy) preloadHolderPolicy(sharedPolicy, state.networkConfig);
}

// DOMContentLoaded is the safe entry point — the script is loaded
// with `defer` in index.html, so this fires after parse.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
