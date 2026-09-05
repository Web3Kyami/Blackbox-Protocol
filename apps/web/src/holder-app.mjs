import { WalletAccountV6, RpcProvider, hash, walletV6 } from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import { buildWalletApiCapabilityActions } from "../../../packages/capability-sdk/src/index.mjs";
import { MAINNET_CHAIN_ID, requirePrivacyWalletFeature, shortHex, walletErrorMessage } from "./wallet-operator.mjs";

const select = document.querySelector("#wallet-select");
const connect = document.querySelector("#wallet-connect");
const account = document.querySelector("#wallet-account");
const network = document.querySelector("#wallet-network");
const status = document.querySelector("#capability-status");
const state = document.querySelector("#capability-state");
const exercise = document.querySelector("#exercise-pass");
const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });
const VERIFIED_HOLDER = "0x5bf4070e91e82a8e087952eb5baf675ff80ca1212538c10ce940e69ba7991c6";
const GATEKEEPER = "0x1126ea67555e0d82c51efe0352f9cf99aec81b7af40ff9c3dab4ccced5b8ff8";
const TOKEN = "0x567bbe5adafeb5920849c695f158bb3d287c702396fa1f87eb9e4978e39b11d";
const ADAPTER = "0x21a77531446c9a0e581e4199d9296d00fe45d279c631d0d0ab16cc66340afd7";
const EXPIRY = 1790419108;
const PAYMENT = 10000000000000000n;
const paymentKey = "blackbox:holder:payment:v1";
let wallets = [];
let walletStore = null;
let holderAccount = null;

const normal = (address) => `0x${BigInt(address).toString(16)}`;

function paymentComplete() {
  exercise.hidden = true;
  exercise.disabled = true;
  status.textContent = "PAYMENT COMPLETE";
  state.querySelector("h3").textContent = "Payment complete";
  state.querySelector("p").textContent = "The fixed 0.01 STRK payment is complete. The pass remains reusable until its expiry.";
}

async function confirmPayment(transactionHash) {
  exercise.hidden = true;
  exercise.disabled = true;
  status.textContent = "CONFIRMING PAYMENT";
  state.querySelector("h3").textContent = "Confirming your payment";
  state.querySelector("p").textContent = "Your wallet has sent the payment. Mainnet is confirming it now; you do not need to do anything.";
  try {
    const receipt = await provider.waitForTransaction(transactionHash, { retries: 120, retryInterval: 3000 });
    if (!receipt.isSuccess()) throw new Error("The payment was not successful.");
    localStorage.setItem(paymentKey, transactionHash);
    paymentComplete();
  } catch (error) {
    localStorage.removeItem(paymentKey);
    status.textContent = "PAYMENT NOT COMPLETED";
    state.querySelector("h3").textContent = "Payment needs review";
    state.querySelector("p").textContent = walletErrorMessage(error);
    exercise.hidden = false;
    exercise.disabled = false;
  }
}

function update(list) {
  wallets = list.filter((wallet) => !String(wallet?.name ?? "").toLowerCase().includes("metamask"));
  select.replaceChildren();
  if (!wallets.length) {
    select.add(new Option("No Starknet wallets detected", "")); connect.disabled = true;
    status.textContent = "NO COMPATIBLE WALLET";
    return;
  }
  wallets.forEach((wallet, index) => select.add(new Option(wallet.name, String(index))));
  connect.disabled = false;
}

connect.addEventListener("click", async () => {
  const wallet = wallets[Number(select.value)];
  if (!wallet) return;
  connect.disabled = true; status.textContent = "CONNECTING";
  try {
    requirePrivacyWalletFeature(wallet);
    const holder = await WalletAccountV6.connect(provider, wallet);
    const chain = `0x${BigInt(await walletV6.requestChainId(wallet)).toString(16)}`;
    account.textContent = shortHex(holder.address); account.title = holder.address;
    network.textContent = chain === MAINNET_CHAIN_ID ? "Starknet Mainnet" : "Switch to Mainnet";
    if (chain !== MAINNET_CHAIN_ID) { status.textContent = "WRONG NETWORK"; return; }
    if (normal(holder.address) !== VERIFIED_HOLDER) {
      holderAccount = null;
      exercise.hidden = true;
      status.textContent = "NO PASS AVAILABLE";
      state.querySelector("h3").textContent = "No pass available";
      state.querySelector("p").textContent = "This wallet does not hold a pass for the active policy. Ask the policy issuer to send one, or switch wallets.";
      connect.textContent = "Switch wallet";
      return;
    }
    holderAccount = holder;
    connect.hidden = true;
    const existingPayment = localStorage.getItem(paymentKey);
    if (existingPayment) { await confirmPayment(existingPayment); return; }
    const policy = await provider.callContract({ contractAddress: GATEKEEPER, entrypoint: "get_policy", calldata: [TOKEN] });
    if (BigInt(policy.at(-1)) >= 1n) { paymentComplete(); return; }
    status.textContent = "READY TO EXERCISE";
    state.querySelector("h3").textContent = "One fixed payment is available";
    state.querySelector("p").textContent = "Pass holder wallet connected. Choose the payment below; your wallet will verify the private pass and show the exact transaction before anything is sent.";
    exercise.hidden = false; exercise.disabled = false;
  } catch (error) { status.textContent = "CONNECTION FAILED"; state.querySelector("p").textContent = walletErrorMessage(error); }
  finally { connect.disabled = false; }
});

exercise.addEventListener("click", async () => {
  if (!holderAccount) return;
  exercise.disabled = true;
  status.textContent = "AWAITING WALLET";
  try {
    const actions = buildWalletApiCapabilityActions({
      policy: {
        gatekeeper: GATEKEEPER, capabilityToken: TOKEN, target: ADAPTER,
        selector: hash.getSelectorFromName("spend"), enforceFirstArgMax: true,
        maxFirstArg: PAYMENT, expiresAt: EXPIRY, reusable: true,
      },
      targetCalldata: [PAYMENT], holderAddress: holderAccount.address,
    });
    const { transaction_hash: transactionHash } = await holderAccount.strk20InvokeTransaction(actions);
    if (!transactionHash) throw new Error("The wallet returned no transaction hash.");
    localStorage.setItem(paymentKey, transactionHash);
    await confirmPayment(transactionHash);
  } catch (error) { status.textContent = "EXERCISE FAILED"; state.querySelector("p").textContent = walletErrorMessage(error); exercise.disabled = false; }
});

try {
  walletStore = createStore();
  update(walletStore.getWallets().slice());
  walletStore.subscribe((list) => update(list.slice()));
  window.setTimeout(() => {
    walletStore?._refreshInjectedWallets();
    update(walletStore?.getWallets().slice() ?? []);
  }, 300);
} catch { update([]); }
