import { RpcProvider, WalletAccountV6, hash, shortString, validateAndParseAddress, walletV6 } from "starknet";
import { createStore } from "@starknet-io/get-starknet-discovery";
import { getAllowance } from "./policy-reads.mjs";

export const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
export const MAINNET_RPC = "https://rpc.starknet.lava.build";
export const MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const STUDIO_MAINNET_FROM_BLOCK = 14_200_000;

export const MAINNET_CLASSES = Object.freeze({
  CapabilityGatekeeper: "0x62b8b737e10c4b06727e9ef672fc0163f8331388e812a249f28cc9edaa63efe",
  CapabilityToken: "0x408fa2fde6f253b3771c43181c8eb8c7f5f71a929c4bd74cb0b25852e5a17e7",
  TreasurySpendAdapter: "0x7617280a31c7ffbf16b5eb18e7f783d1953d295277b293eb816b304041a3da0",
});

export const mainnetProvider = new RpcProvider({ nodeUrl: MAINNET_RPC });

const normal = (value) => `0x${BigInt(value).toString(16)}`;
const hex = (value) => `0x${BigInt(value).toString(16)}`;

export function strkToAtomic(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{0,18})?$/.test(text)) throw new Error("Enter a valid STRK amount.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
}

export function atomicToStrk(value) {
  const atomic = BigInt(value);
  const unit = 10n ** 18n;
  const whole = atomic / unit;
  const fraction = (atomic % unit).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateHolderAmount(value, record) {
  const atomic = strkToAtomic(value);
  if (atomic <= 0n) throw new Error("Enter an amount greater than zero.");
  if (atomic > BigInt(record?.maxFirstArg ?? 0)) {
    throw new Error("The amount is above this mandate's per-payment maximum.");
  }
  if (atomic > BigInt(record?.remainingBudget ?? 0)) {
    throw new Error("The amount is above the mandate's remaining budget.");
  }
  return atomic;
}

export function normalizeStarknetAddress(value) {
  try {
    const address = validateAndParseAddress(String(value || "").trim());
    if (BigInt(address) === 0n) throw new Error("zero address");
    return address;
  }
  catch { throw new Error("Enter a valid Starknet wallet address."); }
}

export function deploymentKey(draft = {}) {
  return [draft.treasury, draft.recipient, draft.asset, draft.cap, draft.budget, draft.supply, draft.mode, draft.expiry]
    .map((value) => String(value || "").trim().toLowerCase()).join("|");
}

export function discoverWallets(onChange) {
  const store = createStore({ eip1193Adapters: [] });
  const clean = (items) => items.filter((wallet) => wallet?.name && typeof wallet?.features?.["starknet:walletApi"]?.request === "function");
  if (onChange) store.subscribe((items) => onChange(clean(items.slice())));
  return { store, wallets: clean(store.getWallets().slice()) };
}

export async function connectMainnetWallet(wallet) {
  if (typeof wallet?.features?.["starknet:walletApi"]?.request !== "function") {
    throw new Error("Choose a Starknet wallet with Wallet API support.");
  }
  const account = await WalletAccountV6.connect(mainnetProvider, wallet);
  const chainId = normal(await walletV6.requestChainId(wallet));
  if (chainId !== MAINNET_CHAIN_ID) throw new Error("Switch this wallet to Starknet Mainnet.");
  return { account, address: normal(account.address), chainId, wallet };
}

async function successful(transactionHash, label) {
  if (!transactionHash) throw new Error(`${label} returned no transaction hash.`);
  const receipt = await mainnetProvider.waitForTransaction(transactionHash, { retries: 120, retryInterval: 3000 });
  if (!receipt.isSuccess()) throw new Error(`${label} was not successful.`);
  return { transactionHash, blockNumber: Number(receipt.block_number || 0) };
}

export function deploymentStage(progress = {}) {
  if (!progress.gatekeeper) return "gatekeeper";
  if (!progress.adapter) return "adapter";
  if (!progress.token) return "token";
  if (!progress.setupTransaction) return "setup";
  return "complete";
}

export async function deployNext(account, draft, plan, progress = {}, onProgress = () => {}) {
  if (!account) throw new Error("Connect the treasury wallet first.");
  const treasury = normalizeStarknetAddress(draft.treasury);
  const recipient = normalizeStarknetAddress(draft.recipient);
  const draftKey = deploymentKey(draft);
  if (progress.draftKey && progress.draftKey !== draftKey) {
    throw new Error("This saved deployment belongs to a different mandate. Return to the workspace and start a new mandate.");
  }
  if (progress.pendingStage && progress.pendingTransaction) {
    const labels = { gatekeeper: "Gatekeeper deployment", adapter: "Treasury Adapter deployment", token: "Capability Token deployment", setup: "Mandate activation" };
    const receipt = await successful(progress.pendingTransaction, labels[progress.pendingStage] || "Mandate transaction");
    const resumed = { ...progress };
    resumed[`${progress.pendingStage}Transaction`] = receipt.transactionHash;
    if (progress.pendingStage === "setup") {
      resumed.setupTransaction = receipt.transactionHash;
      resumed.setupBlock = receipt.blockNumber;
    }
    delete resumed.pendingStage;
    delete resumed.pendingTransaction;
    return resumed;
  }
  const stage = deploymentStage(progress);
  if (stage === "complete") return progress;
  const next = { ...progress, draftKey };
  if (stage === "gatekeeper") {
    const response = await account.deploy({
      classHash: MAINNET_CLASSES.CapabilityGatekeeper,
      constructorCalldata: [MAINNET_POOL],
    });
    next.gatekeeper = normal(response.contract_address[0]);
    next.pendingStage = "gatekeeper";
    next.pendingTransaction = response.transaction_hash;
    onProgress({ ...next });
    const receipt = await successful(response.transaction_hash, "Gatekeeper deployment");
    next.gatekeeperTransaction = receipt.transactionHash;
  } else if (stage === "adapter") {
    const response = await account.deploy({
      classHash: MAINNET_CLASSES.TreasurySpendAdapter,
      constructorCalldata: [next.gatekeeper, treasury, STRK, recipient],
    });
    next.adapter = normal(response.contract_address[0]);
    next.pendingStage = "adapter";
    next.pendingTransaction = response.transaction_hash;
    onProgress({ ...next });
    const receipt = await successful(response.transaction_hash, "Treasury Adapter deployment");
    next.adapterTransaction = receipt.transactionHash;
  } else if (stage === "token") {
    const response = await account.deploy({
      classHash: MAINNET_CLASSES.CapabilityToken,
      constructorCalldata: [
        shortString.encodeShortString(plan.capabilityName || "BlackBox Treasury Pass"),
        shortString.encodeShortString(plan.capabilitySymbol || "BB_STRK"),
        treasury,
        MAINNET_POOL,
        next.gatekeeper,
      ],
    });
    next.token = normal(response.contract_address[0]);
    next.pendingStage = "token";
    next.pendingTransaction = response.transaction_hash;
    onProgress({ ...next });
    const receipt = await successful(response.transaction_hash, "Capability Token deployment");
    next.tokenTransaction = receipt.transactionHash;
  } else {
    const response = await account.execute([
      {
        contractAddress: next.gatekeeper,
        entrypoint: "register_policy",
        calldata: [
          next.token,
          next.adapter,
          hash.getSelectorFromName("spend"),
          "0x1",
          hex(plan.maxAmount),
          hex(plan.expiresAt),
          draft.mode === "reusable" ? "0x1" : "0x0",
        ],
      },
      {
        contractAddress: STRK,
        entrypoint: "approve",
        calldata: [next.adapter, hex(plan.treasuryAllowance), "0x0"],
      },
      {
        contractAddress: next.token,
        entrypoint: "mint",
        calldata: [treasury, hex(plan.supply), "0x0"],
      },
    ]);
    next.pendingStage = "setup";
    next.pendingTransaction = response.transaction_hash;
    onProgress({ ...next });
    const receipt = await successful(response.transaction_hash, "Mandate activation");
    next.setupTransaction = receipt.transactionHash;
    next.setupBlock = receipt.blockNumber;
  }
  delete next.pendingStage;
  delete next.pendingTransaction;
  return next;
}

export async function currentPoolFee(provider = mainnetProvider) {
  const result = await provider.callContract({ contractAddress: MAINNET_POOL, entrypoint: "get_fee_amount", calldata: [] });
  if (!result?.[0]) throw new Error("The privacy pool did not return its fee.");
  return BigInt(result[0]);
}

export async function deliveryApprovalStatus(owner, token, provider = mainnetProvider) {
  const [fee, passAllowance, feeAllowance, observedAtBlock] = await Promise.all([
    currentPoolFee(provider),
    getAllowance(provider, token, owner, MAINNET_POOL),
    getAllowance(provider, STRK, owner, MAINNET_POOL),
    provider.getBlockNumber(),
  ]);
  return {
    approved: BigInt(passAllowance) >= 1n && BigInt(feeAllowance) >= fee,
    passAllowance,
    feeAllowance,
    fee: fee.toString(),
    observedAtBlock: Number(observedAtBlock),
  };
}

export function deliveryTransactionFromEvents(events, owner) {
  const expectedOwner = BigInt(owner);
  const expectedPool = BigInt(MAINNET_POOL);
  const matching = (events || []).filter((event) => {
    const keys = event.keys || [];
    const data = event.data || [];
    if (keys.length < 3 || data.length < 2) return false;
    const amount = BigInt(data[0]) + (BigInt(data[1]) << 128n);
    return BigInt(keys[1]) === expectedOwner && BigInt(keys[2]) === expectedPool && amount >= 1n;
  });
  return matching.length ? matching[matching.length - 1].transaction_hash : null;
}

export async function findPrivatePassDelivery(owner, token, provider = mainnetProvider) {
  const events = [];
  let continuation = undefined;
  do {
    const result = await provider.getEvents({
      address: token,
      keys: [[hash.getSelectorFromName("Transfer")]],
      from_block: { block_number: STUDIO_MAINNET_FROM_BLOCK },
      to_block: "latest",
      continuation_token: continuation,
      chunk_size: 100,
    });
    events.push(...(result.events || []));
    continuation = result.continuation_token;
  } while (continuation);
  const transactionHash = deliveryTransactionFromEvents(events, owner);
  if (!transactionHash) return null;
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (!receipt.isSuccess()) return null;
  return { transactionHash, blockNumber: Number(receipt.block_number || 0) };
}

export async function approvePassDelivery(account, token, amount = 1n, progress = {}, onProgress = () => {}) {
  if (progress.pendingApprovalTransaction) {
    const receipt = await successful(progress.pendingApprovalTransaction, "Pass approval");
    return { ...receipt, fee: progress.fee };
  }
  const fee = await currentPoolFee();
  const response = await account.execute([
    { contractAddress: token, entrypoint: "approve", calldata: [MAINNET_POOL, hex(amount), "0x0"] },
    { contractAddress: STRK, entrypoint: "approve", calldata: [MAINNET_POOL, hex(fee), "0x0"] },
  ]);
  onProgress({ pendingApprovalTransaction: response.transaction_hash, fee: fee.toString() });
  const receipt = await successful(response.transaction_hash, "Pass approval");
  return { ...receipt, fee: fee.toString() };
}

export async function deliverPrivatePass(account, token, recipient, approvalBlock, amount = 1n, progress = {}, onProgress = () => {}) {
  if (progress.pendingDeliveryTransaction) {
    return successful(progress.pendingDeliveryTransaction, "Private pass delivery");
  }
  const currentBlock = await mainnetProvider.getBlockNumber();
  const remaining = Number(approvalBlock) + 10 - currentBlock;
  if (remaining > 0) throw new Error(`Wait ${remaining} more Mainnet block${remaining === 1 ? "" : "s"}, then try again.`);
  const response = await account.strk20InvokeTransaction([
    { type: "deposit", token, amount: hex(amount) },
    { type: "transfer", token, amount: hex(amount), recipient: normalizeStarknetAddress(recipient) },
  ]);
  onProgress({ pendingDeliveryTransaction: response.transaction_hash });
  return successful(response.transaction_hash, "Private pass delivery");
}

export async function prepareHolderProof(account, actions) {
  if (typeof account?.strk20PrepareInvoke !== "function") throw new Error("This wallet cannot check STRK20 permissions.");
  return account.strk20PrepareInvoke(actions, false);
}

export async function exerciseHolderPass(account, actions, progress = {}, onProgress = () => {}) {
  if (progress.completedTransaction) {
    return successful(progress.completedTransaction, "Payment request");
  }
  if (progress.pendingTransaction) return successful(progress.pendingTransaction, "Payment request");
  const response = await account.strk20InvokeTransaction(actions);
  onProgress({ pendingTransaction: response.transaction_hash });
  return successful(response.transaction_hash, "Payment request");
}
