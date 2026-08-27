import { WalletAccountV6, RpcProvider, hash, shortString, walletV6 } from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import { MAINNET_CHAIN_ID, shortHex, walletErrorMessage } from "./wallet-operator.mjs";

const OWNER = "0x1707387d65a03f6ff9d7aaa970b7b7d018cca70cf46b205a6dfa305e5a8076e";
const provider = new RpcProvider({ nodeUrl: "https://rpc.starknet.lava.build" });
const connectButton = document.querySelector("#owner-connect");
const estimateButton = document.querySelector("#estimate-fees");
const deployButton = document.querySelector("#deploy-protocol");
const log = document.querySelector("#deployment-log");
const status = document.querySelector("#deployment-status");
let wallets = []; let account; let config; let artifacts;
const write = (message) => { log.textContent += `${message}\n`; };
const setStatus = (message) => { status.textContent = message; };
const normal = (address) => `0x${BigInt(address).toString(16)}`;
const wait = async (transactionHash, label) => {
  write(`${label}: ${transactionHash}`);
  const receipt = await provider.waitForTransaction(transactionHash);
  if (!receipt.isSuccess()) throw new Error(`${label} was rejected or reverted.`);
  return receipt;
};

async function load() {
  const [loadedConfig, ...files] = await Promise.all([
    fetch("./deployment/config.json").then((r) => r.json()),
    ...["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"].flatMap((name) => [
      fetch(`./deployment/${name}.sierra.json`).then((r) => r.json()),
      fetch(`./deployment/${name}.casm.json`).then((r) => r.json()),
    ]),
  ]);
  config = loadedConfig.deployment;
  artifacts = Object.fromEntries(["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"].map((name, index) => [name, { contract: files[index * 2], casm: files[index * 2 + 1] }]));
  document.querySelector("#expiry").textContent = new Date(Number(config.expiresAt) * 1000).toLocaleString();
  document.querySelector("#recipient").textContent = shortHex(config.recipient);
}

function chosenWallet() { return wallets.find((wallet) => wallet.features?.["starknet:walletApi"]?.request) ?? wallets[0]; }
connectButton.addEventListener("click", async () => {
  const wallet = chosenWallet(); if (!wallet) { setStatus("No compatible Starknet wallet detected."); return; }
  try {
    connectButton.disabled = true; setStatus("Connecting wallet…");
    account = await WalletAccountV6.connect(provider, wallet);
    const chain = normal(await walletV6.requestChainId(wallet));
    document.querySelector("#owner-address").textContent = shortHex(account.address);
    document.querySelector("#owner-network").textContent = chain === MAINNET_CHAIN_ID ? "Starknet Mainnet" : "Wrong network";
    if (chain !== MAINNET_CHAIN_ID) throw new Error("Switch the wallet to Starknet Mainnet.");
    if (normal(account.address) !== OWNER) throw new Error("Connect the funded issuer / treasury wallet for this approved demo.");
    document.querySelector("#owner-status").textContent = "Approved issuer";
    connectButton.textContent = "Issuer wallet connected";
    connectButton.disabled = true;
    estimateButton.disabled = false; deployButton.disabled = false; setStatus("Issuer wallet ready. Estimate first, then deploy when the wallet shows the exact transactions.");
  } catch (error) { document.querySelector("#owner-status").textContent = "Not ready"; setStatus(walletErrorMessage(error)); }
  finally { connectButton.disabled = false; }
});

estimateButton.addEventListener("click", async () => {
  try {
    estimateButton.disabled = true; log.textContent = ""; setStatus("Requesting declaration fee estimates from Mainnet…");
    let total = 0n;
    for (const [name, payload] of Object.entries(artifacts)) {
      const fee = await account.estimateDeclareFee(payload);
      const value = BigInt(fee.overall_fee);
      total += value; write(`${name}: ${value} fri (${Number(value) / 1e18} STRK)`);
    }
    write(`Declaration subtotal: ${total} fri (${Number(total) / 1e18} STRK).`);
    setStatus("Estimates ready. Deployment also includes three deploy transactions and one setup transaction; your wallet will show the final fee before each signature.");
  } catch (error) { setStatus(walletErrorMessage(error)); }
  finally { estimateButton.disabled = false; }
});

deployButton.addEventListener("click", async () => {
  try {
    deployButton.disabled = true; estimateButton.disabled = true; log.textContent = "";
    setStatus("Step 1 of 3: declaring contract classes. Approve only wallet prompts that match this page.");
    const classes = {};
    for (const [name, payload] of Object.entries(artifacts)) {
      const declared = await account.declareIfNot(payload);
      classes[name] = normal(declared.class_hash);
      if (declared.transaction_hash) await wait(declared.transaction_hash, `${name} declared`);
      else write(`${name} was already declared: ${classes[name]}`);
    }
    setStatus("Step 2 of 3: deploying immutable contracts.");
    const gatekeeper = await account.deploy({ classHash: classes.CapabilityGatekeeper, constructorCalldata: [config.privacyPool] });
    await wait(gatekeeper.transaction_hash, "Gatekeeper deployed");
    const gatekeeperAddress = normal(gatekeeper.contract_address[0]);
    const adapter = await account.deploy({ classHash: classes.TreasurySpendAdapter, constructorCalldata: [gatekeeperAddress, config.treasury, config.asset, config.recipient] });
    await wait(adapter.transaction_hash, "Treasury Adapter deployed");
    const adapterAddress = normal(adapter.contract_address[0]);
    const token = await account.deploy({ classHash: classes.CapabilityToken, constructorCalldata: [shortString.encodeShortString(config.capabilityName), shortString.encodeShortString(config.capabilitySymbol), config.issuer, config.privacyPool, gatekeeperAddress] });
    await wait(token.transaction_hash, "Capability Token deployed");
    const tokenAddress = normal(token.contract_address[0]);
    setStatus("Step 3 of 3: registering policy, capping treasury, and minting passes.");
    const setup = await account.execute([
      { contractAddress: gatekeeperAddress, entrypoint: "register_policy", calldata: [tokenAddress, adapterAddress, hash.getSelectorFromName("spend"), "0x1", `0x${BigInt(config.maxAmount).toString(16)}`, `0x${BigInt(config.expiresAt).toString(16)}`, "0x1"] },
      { contractAddress: config.asset, entrypoint: "approve", calldata: [adapterAddress, `0x${BigInt(config.treasuryAllowance).toString(16)}`, "0x0"] },
      { contractAddress: tokenAddress, entrypoint: "mint", calldata: [config.issuer, "0x3", "0x0"] },
    ]);
    await wait(setup.transaction_hash, "Policy setup complete");
    write(`Gatekeeper: ${gatekeeperAddress}`); write(`Treasury Adapter: ${adapterAddress}`); write(`Capability Token: ${tokenAddress}`);
    setStatus("Mainnet demo deployed. Save the three addresses above; next, shield the three passes through a compatible STRK20 wallet.");
  } catch (error) { setStatus(walletErrorMessage(error)); write(`Stopped: ${walletErrorMessage(error)}`); }
  finally { deployButton.disabled = false; estimateButton.disabled = false; }
});

const store = createStore({ eip1193Adapters: [] });
wallets = store.getWallets().slice(); store.subscribe((list) => { wallets = list.slice(); });
load().catch((error) => setStatus(`Could not load deployment files: ${walletErrorMessage(error)}`));
