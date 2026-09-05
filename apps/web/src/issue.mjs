import { WalletAccountV6, RpcProvider, walletV6 } from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import { MAINNET_CHAIN_ID, requirePrivacyWalletFeature, shortHex, walletErrorMessage } from "./wallet-operator.mjs";

const ISSUER = "0x1707387d65a03f6ff9d7aaa970b7b7d018cca70cf46b205a6dfa305e5a8076e";
const TOKEN = "0x567bbe5adafeb5920849c695f158bb3d287c702396fa1f87eb9e4978e39b11d";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const DEFAULT_RECIPIENT = "0x5bf4070e91e82a8e087952eb5baf675ff80ca1212538c10ce940e69ba7991c6";
const EXPIRY = 1790419108;
const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });
const progressKey = "blackbox:mainnet-policy:issue-one-pass:v1";
const legacyProgressKey = "blackbox:mainnet-demo:issue-one-pass:v1";

const elements = {
  connect: document.querySelector("#issuer-connect"), address: document.querySelector("#issuer-address"),
  network: document.querySelector("#issuer-network"), role: document.querySelector("#issuer-role"), api: document.querySelector("#issuer-api"),
  recipient: document.querySelector("#pass-recipient"), expiry: document.querySelector("#pass-expiry"),
  approve: document.querySelector("#approve-pass"),
  issue: document.querySelector("#issue-pass"), status: document.querySelector("#issue-status"),
  statusDot: document.querySelector("#issue-status-dot"), message: document.querySelector("#issue-message"), result: document.querySelector("#issue-result"),
};
elements.recipient.value = DEFAULT_RECIPIENT;
elements.expiry.textContent = new Date(EXPIRY * 1000).toLocaleString();

let wallets = [];
let account = null;
let connectedWallet = null;
const storedProgress = localStorage.getItem(progressKey) ?? localStorage.getItem(legacyProgressKey) ?? "{}";
let approvalBlock = Number(JSON.parse(storedProgress).approvalBlock ?? 0);

const normal = (address) => `0x${BigInt(address).toString(16)}`;

function setState(label, state, message) {
  elements.status.textContent = label;
  elements.statusDot.dataset.state = state;
  elements.message.textContent = message;
}

function renderResult(hash, label, message) {
  elements.result.hidden = false;
  elements.result.replaceChildren();
  const title = document.createElement("strong"); title.textContent = label;
  const text = document.createElement("p"); text.textContent = message;
  const link = document.createElement("a"); link.href = `https://voyager.online/tx/${hash}`; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = `${shortHex(hash)} ↗`;
  elements.result.append(title, text, link);
}

function formatStrk(amount) {
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} STRK`;
}

async function poolFee() {
  const result = await provider.callContract({ contractAddress: POOL, entrypoint: "get_fee_amount", calldata: [] });
  if (!result?.[0]) throw new Error("The STRK20 pool did not return its current fee.");
  return BigInt(result[0]);
}

function connectedIssuer() { return account && normal(account.address) === ISSUER; }

function validRecipient() {
  try {
    const value = normal(elements.recipient.value.trim());
    if (value === ISSUER) throw new Error("Choose a different recipient wallet.");
    return value;
  } catch {
    throw new Error("Enter a valid Starknet recipient address.");
  }
}

function refreshButtons() {
  const issuer = connectedIssuer();
  elements.approve.disabled = !issuer;
  elements.issue.disabled = !issuer || approvalBlock === 0;
}

function openWalletPicker() {
  if (!wallets.length) {
    setState("NO WALLET", "error", "Unlock a compatible Starknet privacy wallet and reload this page.");
    return;
  }
  const backdrop = document.createElement("div"); backdrop.className = "wallet-picker-backdrop";
  const panel = document.createElement("section"); panel.className = "wallet-picker";
  const heading = document.createElement("div"); heading.className = "wallet-picker-heading";
  heading.innerHTML = "<div><h2>Choose issuer wallet</h2><p>Choose the wallet holding the three BlackBox passes.</p></div>";
  const close = document.createElement("button"); close.type = "button"; close.className = "wallet-picker-close"; close.textContent = "×";
  const dismiss = () => backdrop.remove(); close.addEventListener("click", dismiss); backdrop.addEventListener("click", (event) => { if (event.target === backdrop) dismiss(); });
  heading.append(close); panel.append(heading);
  const ordered = [...wallets].sort((left, right) => Number(/ready(?:\s*x)?|argent/i.test(right.name ?? "")) - Number(/ready(?:\s*x)?|argent/i.test(left.name ?? "")));
  for (const wallet of ordered) {
    const choice = document.createElement("button"); choice.type = "button"; choice.className = "wallet-choice";
    choice.innerHTML = `<div><strong>${wallet.name}</strong><span>Connect this wallet</span></div><em>CONNECT</em>`;
    choice.addEventListener("click", () => { dismiss(); connectIssuer(wallet); }); panel.append(choice);
  }
  backdrop.append(panel); document.body.append(backdrop);
}

async function connectIssuer(wallet) {
  elements.connect.disabled = true;
  setState("CONNECTING", "pending", "Approve the connection in your wallet.");
  try {
    requirePrivacyWalletFeature(wallet);
    const candidate = await WalletAccountV6.connect(provider, wallet);
    const chainId = normal(await walletV6.requestChainId(wallet));
    if (chainId !== MAINNET_CHAIN_ID) throw new Error("Switch the wallet to Starknet Mainnet.");
    account = candidate;
    connectedWallet = wallet;
    elements.address.textContent = shortHex(account.address); elements.address.title = account.address;
    elements.network.textContent = "Starknet Mainnet"; elements.api.textContent = "Wallet API detected";
    if (!connectedIssuer()) {
      elements.role.textContent = "Not policy issuer";
      setState("WRONG WALLET", "error", "This wallet is not authorized to issue passes for the active policy.");
      account = null; connectedWallet = null;
    } else {
      elements.role.textContent = "Policy issuer"; elements.connect.textContent = "Wallet connected";
      setState("READY", "ready", "Review the recipient and approve exactly one pass.");
    }
  } catch (error) { setState("CONNECTION FAILED", "error", walletErrorMessage(error)); }
  finally { elements.connect.disabled = false; refreshButtons(); }
}

async function approveOnePass() {
  try {
    elements.approve.disabled = true;
    setState("CHECKING POOL FEE", "pending", "Reading the current public STRK20 pool fee before preparing your approval.");
    const fee = await poolFee();
    setState("AWAITING APPROVAL", "pending", `Your wallet will show public approvals for exactly one BlackBox pass and ${formatStrk(fee)} of pool-fee allowance. No fee is paid at this step.`);
    const response = await account.execute([
      { contractAddress: TOKEN, entrypoint: "approve", calldata: [POOL, "0x1", "0x0"] },
      { contractAddress: STRK, entrypoint: "approve", calldata: [POOL, `0x${fee.toString(16)}`, "0x0"] },
    ]);
    renderResult(response.transaction_hash, "APPROVAL SUBMITTED", `Waiting for the public approvals to finalize before preparing the private delivery. The ${formatStrk(fee)} is an allowance, not a fee payment.`);
    const receipt = await provider.waitForTransaction(response.transaction_hash, { retries: 120, retryInterval: 3000 });
    if (!receipt.isSuccess()) throw new Error("The approval was not successful.");
    approvalBlock = Number(receipt.block_number);
    localStorage.setItem(progressKey, JSON.stringify({ approvalBlock, approvalTransaction: response.transaction_hash }));
    setState("APPROVAL CONFIRMED", "ready", "Pass and pool-fee approvals succeeded. Wait until the private-delivery button says it is ready; STRK20 requires a short block-confirmation window.");
  } catch (error) { setState("APPROVAL FAILED", "error", walletErrorMessage(error)); }
  finally { refreshButtons(); }
}

async function issuePass() {
  try {
    const recipient = validRecipient();
    const currentBlock = await provider.getBlockNumber();
    const blocksRemaining = approvalBlock + 10 - currentBlock;
    if (blocksRemaining > 0) {
      setState("WAITING FOR MAINNET", "pending", `Please wait about ${blocksRemaining} more block${blocksRemaining === 1 ? "" : "s"}, then try again. This protects the privacy proof from using fresh public state.`);
      return;
    }
    const actions = [
      { type: "deposit", token: TOKEN, amount: "0x1" },
      { type: "transfer", token: TOKEN, amount: "0x1", recipient },
    ];
    elements.issue.disabled = true;
    setState("AWAITING FINAL CONFIRMATION", "pending", "Your wallet will build and submit the private proof through its native STRK20 route. Review the final wallet transaction; its public pool fee is charged only if it succeeds.");
    const { transaction_hash: hash } = await account.strk20InvokeTransaction(actions);
    if (!hash) throw new Error("The wallet returned no transaction hash.");
    renderResult(hash, "PRIVATE DELIVERY SUBMITTED", "Waiting for STRK20 and Mainnet confirmation.");
    const receipt = await provider.waitForTransaction(hash, { retries: 120, retryInterval: 3000 });
    if (!receipt.isSuccess()) throw new Error("The private delivery was not successful.");
    setState("PASS DELIVERED", "ready", "One private pass was delivered. The recipient can now open BlackBox App and connect their wallet.");
  } catch (error) { setState("DELIVERY FAILED", "error", walletErrorMessage(error)); }
  finally { refreshButtons(); }
}

elements.connect.addEventListener("click", openWalletPicker);
elements.approve.addEventListener("click", approveOnePass);
elements.issue.addEventListener("click", issuePass);
elements.recipient.addEventListener("input", refreshButtons);

try {
  const store = createStore({ eip1193Adapters: [] });
  const update = (list) => { wallets = list.filter((wallet) => !String(wallet?.name ?? "").toLowerCase().includes("metamask")); };
  update(store.getWallets().slice()); store.subscribe((list) => update(list.slice()));
} catch { wallets = []; }
refreshButtons();
