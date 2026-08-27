import {
  buildWalletApiCapabilityActions,
  buildRegisterPolicyCall,
  describeDisclosure,
} from "../../../packages/capability-sdk/src/index.mjs";
import {
  WalletAccountV6,
  RpcProvider,
  constants,
  walletV6,
} from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import {
  MAINNET_CHAIN_ID,
  actionFingerprint,
  isExamplePolicy,
  parseTargetCalldata,
  relaySeparation,
  requirePrivacyWalletFeature,
  shortHex,
  walletErrorMessage,
} from "./wallet-operator.mjs";

const presets = {
  treasury: {
    name: "Treasury Payout",
    target: "0x300",
    selector: "0x400",
    limit: "5000",
    reusable: true,
  },
  keeper: {
    name: "Protocol Keeper",
    target: "0x310",
    selector: "0x410",
    limit: "100",
    reusable: true,
  },
  guardian: {
    name: "Emergency Guardian",
    target: "0x320",
    selector: "0x420",
    limit: "0",
    reusable: false,
  },
  voice: {
    name: "Community Participant",
    target: "0x330",
    selector: "0x430",
    limit: "1",
    reusable: false,
  },
};

const elements = {
  form: document.querySelector("#policy-form"),
  name: document.querySelector("#policy-name"),
  gatekeeper: document.querySelector("#policy-gatekeeper"),
  capabilityToken: document.querySelector("#policy-token"),
  target: document.querySelector("#policy-target"),
  selector: document.querySelector("#policy-selector"),
  limit: document.querySelector("#policy-limit"),
  expiry: document.querySelector("#policy-expiry"),
  previewName: document.querySelector("#preview-name"),
  previewTarget: document.querySelector("#preview-target"),
  previewSelector: document.querySelector("#preview-selector"),
  previewLimit: document.querySelector("#preview-limit"),
  previewMode: document.querySelector("#preview-mode"),
  previewSentence: document.querySelector("#preview-sentence"),
  previewCalldata: document.querySelector("#preview-calldata"),
  previewStatus: document.querySelector("#preview-status"),
  previewError: document.querySelector("#preview-error"),
  hiddenList: document.querySelector("#hidden-list"),
  publicList: document.querySelector("#public-list"),
  walletSelect: document.querySelector("#wallet-select"),
  walletConnect: document.querySelector("#wallet-connect"),
  walletSwitch: document.querySelector("#wallet-switch"),
  walletAccount: document.querySelector("#wallet-account"),
  walletNetwork: document.querySelector("#wallet-network"),
  walletApi: document.querySelector("#wallet-api"),
  operatorCalldata: document.querySelector("#operator-calldata"),
  operatorPreview: document.querySelector("#operator-preview"),
  operatorPrepare: document.querySelector("#operator-prepare"),
  operatorExecute: document.querySelector("#operator-execute"),
  operatorActions: document.querySelector("#operator-actions"),
  operatorMessage: document.querySelector("#operator-message"),
  operatorStatus: document.querySelector("#operator-status"),
  operatorStatusDot: document.querySelector("#operator-status-dot"),
  operatorResult: document.querySelector("#operator-result"),
};

function selectedReusable() {
  return document.querySelector('input[name="reuse"]:checked')?.value === "reusable";
}

function expirationTimestamp() {
  const milliseconds = Date.parse(elements.expiry.value);
  if (!Number.isFinite(milliseconds)) throw new Error("Choose a valid expiration date.");
  return BigInt(Math.floor(milliseconds / 1000));
}

function formPolicy() {
  const limit = BigInt(elements.limit.value || "0");
  return {
    gatekeeper: elements.gatekeeper.value.trim(),
    capabilityToken: elements.capabilityToken.value.trim(),
    target: elements.target.value.trim(),
    selector: elements.selector.value.trim(),
    enforceFirstArgMax: limit > 0n,
    maxFirstArg: limit,
    expiresAt: expirationTimestamp(),
    reusable: selectedReusable(),
  };
}

function renderList(element, entries) {
  element.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      return item;
    }),
  );
}

function renderPreview() {
  try {
    const policy = formPolicy();
    const call = buildRegisterPolicyCall(policy);
    const name = elements.name.value.trim() || "Untitled capability";
    const limitText = policy.enforceFirstArgMax
      ? `≤ ${policy.maxFirstArg.toLocaleString("en-US")}`
      : "Not enforced";

    elements.previewName.textContent = name;
    elements.previewTarget.textContent = policy.target;
    elements.previewSelector.textContent = policy.selector;
    elements.previewLimit.textContent = limitText;
    elements.previewMode.textContent = policy.reusable ? "Reusable" : "One-shot";
    elements.previewSentence.textContent = policy.enforceFirstArgMax
      ? `The holder may call only selector ${policy.selector} on ${policy.target} with a first argument no greater than ${policy.maxFirstArg.toLocaleString("en-US")}.`
      : `The holder may call only selector ${policy.selector} on ${policy.target}. This policy does not interpret its calldata.`;
    elements.previewCalldata.textContent = JSON.stringify(call, null, 2);
    elements.previewStatus.textContent = "VALID";
    elements.previewStatus.className = "";
    elements.previewError.hidden = true;

    const disclosure = describeDisclosure({ reusable: policy.reusable });
    renderList(elements.hiddenList, disclosure.hidden);
    renderList(elements.publicList, disclosure.public);
  } catch (error) {
    elements.previewStatus.textContent = "INVALID";
    elements.previewStatus.className = "invalid";
    elements.previewError.textContent = error instanceof Error ? error.message : String(error);
    elements.previewError.hidden = false;
  }
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset) return;
  elements.name.value = preset.name;
  elements.target.value = preset.target;
  elements.selector.value = preset.selector;
  elements.limit.value = preset.limit;
  const mode = preset.reusable ? "reusable" : "oneshot";
  const radio = document.querySelector(`input[name="reuse"][value="${mode}"]`);
  if (radio) radio.checked = true;
  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === name);
  });
  renderPreview();
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  renderPreview();
});

elements.form.addEventListener("input", () => {
  elements.previewStatus.textContent = "EDITED";
  elements.previewStatus.className = "edited";
  invalidateOperatorPreview("Policy changed. Preview the wallet actions again.");
});

renderPreview();

const mainnetProvider = new RpcProvider({
  nodeUrl: "https://rpc.starknet.lava.build",
});
const operator = {
  wallets: [],
  selectedWallet: null,
  walletAccount: null,
  chainId: null,
  actions: null,
  preparedFingerprint: null,
};

function normalizeChainId(chainId) {
  try {
    return `0x${BigInt(chainId).toString(16)}`;
  } catch {
    return String(chainId ?? "");
  }
}

function setOperatorState(label, state = "idle", message) {
  elements.operatorStatus.textContent = label;
  elements.operatorStatusDot.dataset.state = state;
  if (message !== undefined) elements.operatorMessage.textContent = message;
}

function invalidateOperatorPreview(message) {
  operator.actions = null;
  operator.preparedFingerprint = null;
  elements.operatorPrepare.disabled = true;
  elements.operatorExecute.disabled = true;
  if (message && elements.operatorMessage) {
    setOperatorState("ACTION NEEDS REVIEW", "idle", message);
  }
}

function updateWalletPicker(wallets) {
  operator.wallets = wallets.filter((wallet) => {
    const name = String(wallet?.name ?? "").toLowerCase();
    return !name.includes("metamask");
  });
  const previous = elements.walletSelect.value;
  elements.walletSelect.replaceChildren();
  if (operator.wallets.length === 0) {
    elements.walletSelect.add(new Option("No Starknet wallets detected", ""));
    elements.walletConnect.disabled = true;
    return;
  }
  operator.wallets.forEach((wallet, index) => {
    elements.walletSelect.add(new Option(wallet.name, String(index)));
  });
  if (previous && Number(previous) < operator.wallets.length) {
    elements.walletSelect.value = previous;
  }
  elements.walletConnect.disabled = false;
}

function connectedOnMainnet() {
  return operator.walletAccount && operator.chainId === MAINNET_CHAIN_ID;
}

function displayChain(chainId) {
  if (chainId === MAINNET_CHAIN_ID) return "Starknet Mainnet";
  if (chainId === normalizeChainId(constants.StarknetChainId.SN_SEPOLIA)) {
    return "Starknet Sepolia";
  }
  return chainId ? `Unsupported · ${shortHex(chainId)}` : "Unknown";
}

async function refreshWalletFacts() {
  if (!operator.selectedWallet || !operator.walletAccount) return;
  const chainId = normalizeChainId(
    await walletV6.requestChainId(operator.selectedWallet),
  );
  operator.chainId = chainId;
  elements.walletAccount.textContent = shortHex(operator.walletAccount.address);
  elements.walletAccount.title = operator.walletAccount.address;
  elements.walletNetwork.textContent = displayChain(chainId);
  elements.walletSwitch.hidden = chainId === MAINNET_CHAIN_ID;
  invalidateOperatorPreview(
    chainId === MAINNET_CHAIN_ID
      ? "Connected. Preview the exact wallet actions before preparing."
      : "BlackBox live execution is gated to Starknet Mainnet. Switch networks before preparing.",
  );
}

async function connectWallet() {
  const selected = operator.wallets[Number(elements.walletSelect.value)];
  if (!selected) {
    setOperatorState("NO WALLET SELECTED", "error", "Choose a detected Starknet wallet.");
    return;
  }
  elements.walletConnect.disabled = true;
  setOperatorState("CONNECTING", "pending", "Approve the account connection in your wallet.");
  try {
    requirePrivacyWalletFeature(selected);
    const walletAccount = await WalletAccountV6.connect(mainnetProvider, selected);
    if (!walletAccount.address) throw new Error("The wallet did not return an account address.");
    const specs = await walletV6.supportedSpecs(selected);
    operator.selectedWallet = selected;
    operator.walletAccount = walletAccount;
    elements.walletApi.textContent = Array.isArray(specs) && specs.length
      ? specs.join(", ")
      : "Wallet API detected";
    await refreshWalletFacts();
    setOperatorState(
      connectedOnMainnet() ? "WALLET CONNECTED" : "WRONG NETWORK",
      connectedOnMainnet() ? "ready" : "error",
      connectedOnMainnet()
        ? "Wallet API detected. STRK20 support is confirmed only after preparation succeeds."
        : "Switch this wallet to Starknet Mainnet before preparing a capability action.",
    );
  } catch (error) {
    operator.selectedWallet = null;
    operator.walletAccount = null;
    elements.walletAccount.textContent = "Not connected";
    elements.walletNetwork.textContent = "Unknown";
    elements.walletApi.textContent = "Unsupported or rejected";
    setOperatorState("CONNECTION FAILED", "error", walletErrorMessage(error));
  } finally {
    elements.walletConnect.disabled = false;
  }
}

async function switchToMainnet() {
  if (!operator.walletAccount) return;
  elements.walletSwitch.disabled = true;
  setOperatorState("SWITCHING NETWORK", "pending", "Approve Starknet Mainnet in your wallet.");
  try {
    const switched = await operator.walletAccount.switchStarknetChain(
      constants.StarknetChainId.SN_MAIN,
    );
    if (!switched) throw new Error("The wallet did not switch to Starknet Mainnet.");
    await refreshWalletFacts();
    setOperatorState("WALLET CONNECTED", "ready", "Mainnet selected. Preview the wallet actions.");
  } catch (error) {
    setOperatorState("NETWORK SWITCH FAILED", "error", walletErrorMessage(error));
  } finally {
    elements.walletSwitch.disabled = false;
  }
}

function buildCurrentActions({ requireLive = false } = {}) {
  if (!operator.walletAccount) throw new Error("Connect a privacy wallet first.");
  if (!connectedOnMainnet()) throw new Error("Switch the wallet to Starknet Mainnet first.");
  const policy = formPolicy();
  if (Number(policy.expiresAt) <= Math.floor(Date.now() / 1000)) {
    throw new Error("This policy expiry is already in the past.");
  }
  if (requireLive && isExamplePolicy(policy)) {
    throw new Error("Replace every example address with a confirmed deployed policy.");
  }
  return {
    policy,
    actions: buildWalletApiCapabilityActions({
      policy,
      targetCalldata: parseTargetCalldata(elements.operatorCalldata.value),
      holderAddress: operator.walletAccount.address,
    }),
  };
}

function previewOperatorActions() {
  try {
    const { policy, actions } = buildCurrentActions();
    operator.actions = actions;
    operator.preparedFingerprint = null;
    elements.operatorActions.textContent = JSON.stringify(actions, null, 2);
    elements.operatorExecute.disabled = true;
    if (isExamplePolicy(policy)) {
      elements.operatorPrepare.disabled = true;
      setOperatorState(
        "PREVIEW ONLY",
        "error",
        "The exact Wallet API actions are shown, but example addresses are blocked from preparation and execution.",
      );
    } else {
      elements.operatorPrepare.disabled = false;
      setOperatorState(
        "READY TO PREPARE",
        "ready",
        "Review the public target, selector, calldata, mode, and expiry. Preparation will ask the wallet to prove and simulate.",
      );
    }
  } catch (error) {
    invalidateOperatorPreview();
    elements.operatorActions.textContent = "No valid action preview.";
    setOperatorState("ACTION INVALID", "error", walletErrorMessage(error));
  }
}

async function prepareOperatorAction() {
  elements.operatorPrepare.disabled = true;
  elements.operatorExecute.disabled = true;
  setOperatorState("WALLET PREPARING", "pending", "The wallet is selecting notes, proving, and simulating. BlackBox does not receive the proof output.");
  try {
    const { actions } = buildCurrentActions({ requireLive: true });
    if (actionFingerprint(actions) !== actionFingerprint(operator.actions ?? [])) {
      throw new Error("The action changed after preview. Preview it again.");
    }
    await operator.walletAccount.strk20PrepareInvoke(actions, true);
    operator.preparedFingerprint = actionFingerprint(actions);
    elements.operatorExecute.disabled = false;
    setOperatorState(
      "PREPARED + SIMULATED",
      "ready",
      "The wallet accepted the STRK20 action. Execution is a separate confirmation and may still fail if network state changes.",
    );
  } catch (error) {
    operator.preparedFingerprint = null;
    setOperatorState("PREPARATION FAILED", "error", walletErrorMessage(error));
  } finally {
    elements.operatorPrepare.disabled = false;
  }
}

function renderTransactionResult(transactionHash, state, message) {
  elements.operatorResult.hidden = false;
  elements.operatorResult.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = state;
  const text = document.createElement("p");
  text.textContent = message;
  const link = document.createElement("a");
  link.href = `https://voyager.online/tx/${transactionHash}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${shortHex(transactionHash)} ↗`;
  elements.operatorResult.append(title, text, link);
}

async function executeOperatorAction() {
  elements.operatorPrepare.disabled = true;
  elements.operatorExecute.disabled = true;
  try {
    const { actions } = buildCurrentActions({ requireLive: true });
    const fingerprint = actionFingerprint(actions);
    if (!operator.preparedFingerprint || fingerprint !== operator.preparedFingerprint) {
      throw new Error("Prepare this exact action before execution.");
    }
    setOperatorState("AWAITING CONFIRMATION", "pending", "Confirm execution in the wallet. The wallet owns proof and submission.");
    const { transaction_hash: transactionHash } =
      await operator.walletAccount.strk20InvokeTransaction(actions);
    if (!transactionHash) throw new Error("The wallet returned no transaction hash.");
    operator.preparedFingerprint = null;
    renderTransactionResult(
      transactionHash,
      "SUBMITTED",
      "Waiting for confirmation and transaction-sender verification.",
    );
    setOperatorState("SUBMITTED", "pending", "The transaction is public. Waiting to verify that its sender is not the holder wallet.");
    const receipt = await mainnetProvider.waitForTransaction(transactionHash, {
      retries: 120,
      retryInterval: 3000,
    });
    if (!receipt.isSuccess()) throw new Error("The submitted transaction did not succeed.");
    const transaction = await mainnetProvider.getTransaction(transactionHash);
    const separation = relaySeparation({
      holderAddress: operator.walletAccount.address,
      senderAddress: transaction.sender_address,
    });
    if (!separation.verified) {
      renderTransactionResult(
        transactionHash,
        "CONFIRMED · SENDER PRIVACY NOT VERIFIED",
        "The transaction succeeded, but BlackBox could not prove a sender distinct from the holder. Do not claim operator privacy for this execution.",
      );
      setOperatorState("PRIVACY CHECK FAILED", "error", "Execution succeeded, but relay-sender separation was not verified.");
      return;
    }
    renderTransactionResult(
      transactionHash,
      "CONFIRMED · RELAY SEPARATION VERIFIED",
      `The public transaction sender ${shortHex(separation.sender)} differs from the connected holder ${shortHex(separation.holder)}.`,
    );
    setOperatorState("EXECUTION VERIFIED", "ready", "Onchain success and holder-versus-sender separation are verified for this transaction.");
  } catch (error) {
    setOperatorState("EXECUTION FAILED", "error", walletErrorMessage(error));
  } finally {
    elements.operatorPrepare.disabled = !operator.actions;
  }
}

elements.walletConnect.addEventListener("click", connectWallet);
elements.walletSwitch.addEventListener("click", switchToMainnet);
elements.operatorPreview.addEventListener("click", previewOperatorActions);
elements.operatorPrepare.addEventListener("click", prepareOperatorAction);
elements.operatorExecute.addEventListener("click", executeOperatorAction);
elements.operatorCalldata.addEventListener("input", () => {
  invalidateOperatorPreview("Target calldata changed. Preview the wallet actions again.");
});

try {
  const walletStore = createStore({ eip1193Adapters: [] });
  updateWalletPicker(walletStore.getWallets().slice());
  walletStore.subscribe((wallets) => updateWalletPicker(wallets.slice()));
} catch (error) {
  updateWalletPicker([]);
  setOperatorState("WALLET DISCOVERY FAILED", "error", walletErrorMessage(error));
}
