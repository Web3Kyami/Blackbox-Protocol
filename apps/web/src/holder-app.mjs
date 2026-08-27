import { WalletAccountV6, RpcProvider, constants, walletV6 } from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import { MAINNET_CHAIN_ID, requirePrivacyWalletFeature, shortHex, walletErrorMessage } from "./wallet-operator.mjs";

const select = document.querySelector("#wallet-select");
const connect = document.querySelector("#wallet-connect");
const account = document.querySelector("#wallet-account");
const network = document.querySelector("#wallet-network");
const api = document.querySelector("#wallet-api");
const status = document.querySelector("#capability-status");
const state = document.querySelector("#capability-state");
const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });
let wallets = [];

function update(list) {
  wallets = list.filter((wallet) => !String(wallet?.name ?? "").toLowerCase().includes("metamask"));
  select.replaceChildren();
  if (!wallets.length) { select.add(new Option("No Starknet wallets detected", "")); connect.disabled = true; return; }
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
    api.textContent = "Wallet API detected";
    if (chain !== MAINNET_CHAIN_ID) { status.textContent = "WRONG NETWORK"; return; }
    status.textContent = "NO CAPABILITIES YET";
    state.querySelector("h3").textContent = "No active capability found";
    state.querySelector("p").textContent = "This wallet is connected. A real private pass will appear after a BlackBox policy is deployed and issued to this wallet.";
  } catch (error) { status.textContent = "CONNECTION FAILED"; api.textContent = walletErrorMessage(error); }
  finally { connect.disabled = false; }
});

try { const store = createStore({ eip1193Adapters: [] }); update(store.getWallets().slice()); store.subscribe((list) => update(list.slice())); } catch { update([]); }
