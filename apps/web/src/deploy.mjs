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
let wallets = []; let account; let connectedWallet; let config; let artifacts;
const progressKey = "blackbox:mainnet-demo:deployment-progress:v1";
let progress = JSON.parse(localStorage.getItem(progressKey) ?? "{}");
const write = (message) => { log.textContent += `${message}\n`; };
const setStatus = (message) => { status.textContent = message; };
const normal = (address) => `0x${BigInt(address).toString(16)}`;
const wait = async (transactionHash, label) => {
  write(`${label}: ${transactionHash}`);
  const receipt = await provider.waitForTransaction(transactionHash);
  if (!receipt.isSuccess()) throw new Error(`${label} was rejected or reverted.`);
  return receipt;
};

// The debug map is compiler metadata, not executable Sierra. Wallet declaration
// requests need only the canonical class fields; omitting it preserves the
// class hash while avoiding unnecessary extension parsing and payload work.
function declarationClass(contract) {
  return {
    sierra_program: contract.sierra_program,
    contract_class_version: contract.contract_class_version,
    entry_points_by_type: contract.entry_points_by_type,
    abi: contract.abi,
  };
}

async function load() {
  const [loadedConfig, ...files] = await Promise.all([
    fetch("./deployment/config.json").then((r) => r.json()),
    ...["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"].flatMap((name) => [
      fetch(`./deployment/${name}.sierra.json`).then((r) => r.json()),
      fetch(`./deployment/${name}.casm.json`).then((r) => r.json()),
    ]),
  ]);
  config = loadedConfig.deployment;
  artifacts = Object.fromEntries(["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"].map((name, index) => [name, { contract: declarationClass(files[index * 2]), casm: files[index * 2 + 1] }]));
  const classes = progress.classes ?? (progress.classes = {});
  for (const [name, payload] of Object.entries(artifacts)) {
    const classHash = normal(hash.computeContractClassHash(payload.contract));
    try {
      await provider.getClassByHash(classHash);
      classes[name] = classHash;
    } catch {
      // Class is not yet declared. The normal deployment step remains available.
    }
  }
  saveProgress();
  document.querySelector("#expiry").textContent = new Date(Number(config.expiresAt) * 1000).toLocaleString();
  document.querySelector("#recipient").textContent = shortHex(config.recipient);
}

function chosenWallet() { return wallets.find((wallet) => wallet.features?.["starknet:walletApi"]?.request) ?? wallets[0]; }

// Ready X's reference dapp uses this raw Wallet API request rather than the
// WalletAccount declaration helper. Keep this shape identical to the public
// wallet_addDeclareTransaction specification: the extension owns fee pricing,
// review, signing, and broadcast.
async function requestWalletDeclaration(payload) {
  const request = connectedWallet?.features?.["starknet:walletApi"]?.request;
  if (typeof request !== "function") throw new Error("The connected wallet does not expose the declaration request API.");
  return request({
    type: "wallet_addDeclareTransaction",
    params: {
      contract_class: payload.contract,
      compiled_class_hash: hash.computeCompiledClassHash(payload.casm),
    },
  });
}

function saveProgress() { localStorage.setItem(progressKey, JSON.stringify(progress)); }

function nextStep() {
  const classes = progress.classes ?? {};
  if (!classes.CapabilityGatekeeper) return ["Declare Gatekeeper", "Declare the Gatekeeper class in one Ready X confirmation."];
  if (!classes.CapabilityToken) return ["Declare Capability Token", "Declare the pass-token class in one Ready X confirmation."];
  if (!classes.TreasurySpendAdapter) return ["Declare Treasury Adapter", "Declare the fixed treasury-adapter class in one Ready X confirmation."];
  if (!progress.gatekeeper) return ["Deploy Gatekeeper", "Deploy the Gatekeeper instance in one Ready X confirmation."];
  if (!progress.adapter) return ["Deploy Treasury Adapter", "Deploy the fixed treasury-adapter instance in one Ready X confirmation."];
  if (!progress.token) return ["Deploy Capability Token", "Deploy the three-pass capability token in one Ready X confirmation."];
  if (!progress.setupTransaction) return ["Register policy & mint passes", "Register the policy, approve the fixed 0.03 STRK budget, and mint three passes in one Ready X confirmation."];
  return ["Deployment complete", "The public contracts are deployed. Keep the addresses below for private pass issuance."];
}

function renderNextStep() {
  const [label, detail] = nextStep();
  deployButton.textContent = label;
  deployButton.disabled = !account || label === "Deployment complete";
  if (account) setStatus(detail);
}
connectButton.addEventListener("click", async () => {
  const wallet = chosenWallet(); if (!wallet) { setStatus("No compatible Starknet wallet detected."); return; }
  try {
    connectButton.disabled = true; setStatus("Connecting wallet…");
    account = await WalletAccountV6.connect(provider, wallet);
    connectedWallet = wallet;
    const chain = normal(await walletV6.requestChainId(wallet));
    document.querySelector("#owner-address").textContent = shortHex(account.address);
    document.querySelector("#owner-network").textContent = chain === MAINNET_CHAIN_ID ? "Starknet Mainnet" : "Wrong network";
    if (chain !== MAINNET_CHAIN_ID) throw new Error("Switch the wallet to Starknet Mainnet.");
    if (normal(account.address) !== OWNER) throw new Error("Connect the funded issuer / treasury wallet for this approved demo.");
    document.querySelector("#owner-status").textContent = "Approved issuer";
    connectButton.textContent = "Issuer wallet connected";
    connectButton.disabled = true;
    estimateButton.disabled = false; renderNextStep();
  } catch (error) { document.querySelector("#owner-status").textContent = "Not ready"; setStatus(walletErrorMessage(error)); }
  finally { if (!account || normal(account.address) !== OWNER) connectButton.disabled = false; }
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
    deployButton.disabled = true; estimateButton.disabled = true;
    const classes = progress.classes ?? (progress.classes = {});
    if (!classes.CapabilityGatekeeper || !classes.CapabilityToken || !classes.TreasurySpendAdapter) {
      const name = !classes.CapabilityGatekeeper ? "CapabilityGatekeeper" : !classes.CapabilityToken ? "CapabilityToken" : "TreasurySpendAdapter";
      const payload = artifacts[name]; const classHash = normal(hash.computeContractClassHash(payload.contract));
      setStatus(`Ready X is preparing one declaration: ${name}.`);
      try {
        const declared = await requestWalletDeclaration(payload);
        await wait(declared.transaction_hash, `${name} declared`);
      } catch (error) {
        if (!/already declared|class already/i.test(walletErrorMessage(error))) throw error;
        write(`${name} was already declared on Mainnet.`);
      }
      classes[name] = classHash; saveProgress(); write(`${name} class hash: ${classHash}`);
    } else if (!progress.gatekeeper) {
      setStatus("Ready X is preparing the Gatekeeper deployment.");
      const response = await account.deploy({ classHash: classes.CapabilityGatekeeper, constructorCalldata: [config.privacyPool] });
      await wait(response.transaction_hash, "Gatekeeper deployed"); progress.gatekeeper = normal(response.contract_address[0]); saveProgress(); write(`Gatekeeper: ${progress.gatekeeper}`);
    } else if (!progress.adapter) {
      setStatus("Ready X is preparing the Treasury Adapter deployment.");
      const response = await account.deploy({ classHash: classes.TreasurySpendAdapter, constructorCalldata: [progress.gatekeeper, config.treasury, config.asset, config.recipient] });
      await wait(response.transaction_hash, "Treasury Adapter deployed"); progress.adapter = normal(response.contract_address[0]); saveProgress(); write(`Treasury Adapter: ${progress.adapter}`);
    } else if (!progress.token) {
      setStatus("Ready X is preparing the Capability Token deployment.");
      const response = await account.deploy({ classHash: classes.CapabilityToken, constructorCalldata: [shortString.encodeShortString(config.capabilityName), shortString.encodeShortString(config.capabilitySymbol), config.issuer, config.privacyPool, progress.gatekeeper] });
      await wait(response.transaction_hash, "Capability Token deployed"); progress.token = normal(response.contract_address[0]); saveProgress(); write(`Capability Token: ${progress.token}`);
    } else if (!progress.setupTransaction) {
      setStatus("Ready X is preparing the final public setup transaction.");
      const setup = await account.execute([
        { contractAddress: progress.gatekeeper, entrypoint: "register_policy", calldata: [progress.token, progress.adapter, hash.getSelectorFromName("spend"), "0x1", `0x${BigInt(config.maxAmount).toString(16)}`, `0x${BigInt(config.expiresAt).toString(16)}`, "0x1"] },
        { contractAddress: config.asset, entrypoint: "approve", calldata: [progress.adapter, `0x${BigInt(config.treasuryAllowance).toString(16)}`, "0x0"] },
        { contractAddress: progress.token, entrypoint: "mint", calldata: [config.issuer, "0x3", "0x0"] },
      ]);
      await wait(setup.transaction_hash, "Policy setup complete"); progress.setupTransaction = setup.transaction_hash; saveProgress();
      write(`Gatekeeper: ${progress.gatekeeper}`); write(`Treasury Adapter: ${progress.adapter}`); write(`Capability Token: ${progress.token}`);
    }
  } catch (error) { setStatus(walletErrorMessage(error)); write(`Stopped: ${walletErrorMessage(error)}`); }
  finally { estimateButton.disabled = false; renderNextStep(); }
});

const store = createStore({ eip1193Adapters: [] });
wallets = store.getWallets().slice(); store.subscribe((list) => { wallets = list.slice(); });
load().catch((error) => setStatus(`Could not load deployment files: ${walletErrorMessage(error)}`));
