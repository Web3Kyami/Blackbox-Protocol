// Cross-network diagnostic: checks the deployer address balances on BOTH
// Sepolia and Mainnet to detect wrong-network funding.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider, Contract } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

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

const NETWORKS = [
  { name: "Sepolia", url: "https://starknet-sepolia-rpc.publicnode.com" },
  { name: "Mainnet", url: "https://starknet-rpc.publicnode.com" },
];
const TOKENS = [
  { symbol: "STRK", address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d" },
  { symbol: "ETH", address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7" },
];
const ERC20_ABI = [
  {
    name: "balance_of",
    type: "function",
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ name: "balance", type: "core::integer::u256" }],
    state_mutability: "view",
  },
];

function fmt(b) {
  const whole = b / 10n ** 18n;
  const frac = b % 10n ** 18n;
  return `${whole}.${frac.toString().padStart(18, "0").slice(0, 4)}`;
}

for (const n of NETWORKS) {
  try {
    const provider = new RpcProvider({ nodeUrl: n.url });
    const chainId = await provider.getChainId();
    console.log(`\n=== ${n.name} (${chainId}) ===`);
    for (const t of TOKENS) {
      try {
        const c = new Contract({ abi: ERC20_ABI, address: t.address, providerOrAccount: provider });
        const raw = await c.call("balance_of", [address]);
        const bal =
          typeof raw === "bigint"
            ? raw
            : BigInt(raw?.low ?? 0) + (BigInt(raw?.high ?? 0) << 128n);
        if (bal > 0n) console.log(`  ${t.symbol}: ${fmt(bal)}  <-- FUNDED`);
        else console.log(`  ${t.symbol}: ${fmt(bal)}`);
      } catch (err) {
        console.log(`  ${t.symbol}: read failed (${err.message?.slice(0, 50)})`);
      }
    }
  } catch (err) {
    console.log(`\n=== ${n.name} unreachable: ${err.message?.slice(0, 60)}`);
  }
}
