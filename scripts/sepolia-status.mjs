// Checks STRK/ETH balance and deployment status of the Sepolia deployer account
// via raw JSON-RPC (bypasses starknet.js u256 ABI parsing quirks).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const address = env.STARKNET_ACCOUNT_ADDRESS;
const RPC = "https://starknet-sepolia-rpc.publicnode.com";
const STRK_TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

async function rpcCall(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return res.json();
}
async function tokenBalanceRaw(tokenAddress) {
  const json = await rpcCall("starknet_call", [
    {
      contract_address: tokenAddress,
      entry_point_selector: "0x" + hash.starknetKeccak("balance_of").toString(16),
      calldata: [address],
    },
    "latest",
  ]);
  if (!json.result) return null;
  const low = BigInt(json.result[0]);
  const high = BigInt(json.result[1] ?? 0);
  return low + (high << 128n);
}

console.log(`RPC: ${RPC}`);
console.log(`Account: ${address}`);
for (const [sym, addr] of [
  ["STRK", STRK_TOKEN],
  ["ETH", "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"],
]) {
  const bal = await tokenBalanceRaw(addr);
  if (bal === null) {
    console.log(`${sym} balance: <read failed>`);
    continue;
  }
  console.log(
    `${sym} balance: ${bal / 10n ** 18n}.${(bal % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)} ${sym}`,
  );
}
const cls = await rpcCall("starknet_getClassAt", ["latest", address]);
console.log(`Account deployed: ${cls.error ? "no" : "yes"}`);
