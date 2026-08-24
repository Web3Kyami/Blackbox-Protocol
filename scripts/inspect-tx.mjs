// Inspects a Sepolia transaction: status, sender, and decoded transfer legs.
import { RpcProvider } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const TX = process.argv[2] ?? "0x258b6816c25918bb0cc702ce578c848a91e224375e94a4093875ac7f4fdedce";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const provider = new RpcProvider({ nodeUrl: "https://starknet-sepolia-rpc.publicnode.com" });

const tx = await provider.getTransactionByHash(TX).catch((e) => {
  console.log("getTransactionByHash failed:", e.message?.slice(0, 100));
  return null;
});
if (!tx) process.exit(1);

console.log("type:", tx.type);
console.log("sender_address:", tx.sender_address);

const receipt = await provider.getTransactionReceipt(TX).catch((e) => {
  console.log("receipt fetch failed:", e.message?.slice(0, 100));
  return null;
});
if (receipt) {
  console.log("finality/status:", receipt.finality_status ?? receipt.status);
  console.log("execution_status:", receipt.execution_status ?? receipt.execution_status);
  console.log("actual_fee:", receipt.actual_fee ? JSON.stringify(receipt.actual_fee) : "n/a");
}

// Decode ERC20 transfer events: keys = [transfer_selector, from, to], data = [low, high]
const TOKENS = { [STRK.toLowerCase()]: "STRK", [ETH.toLowerCase()]: "ETH" };
const events = receipt?.events ?? [];
console.log(`\ntotal events: ${events.length}`);
for (const [i, ev] of events.entries()) {
  const token = TOKENS[ev.from_address?.toLowerCase()];
  console.log(`\n[event ${i}] contract: ${ev.from_address}`);
  console.log("  keys:", JSON.stringify(ev.keys));
  console.log("  data:", JSON.stringify(ev.data));
  if (token && ev.keys && ev.keys.length >= 3) {
    const from = "0x" + BigInt(ev.keys[1]).toString(16);
    const to = "0x" + BigInt(ev.keys[2]).toString(16);
    const amount = BigInt(ev.data[0]) + (BigInt(ev.data[1] ?? 0) << 128n);
    const human =
      amount / 10n ** 18n !== 0n
        ? `${amount / 10n ** 18n}.${(amount % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)}`
        : `${amount} raw`;
    console.log(`  ==> ${token} TRANSFER from ${from} to ${to} amount ${human}`);
  }
}
console.log("\ncalldata:", JSON.stringify(tx.calldata ?? []));
