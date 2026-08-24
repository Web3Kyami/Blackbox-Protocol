// Raw starknet_call diagnostics for STRK balance across multiple providers.
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
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const SEL = "0x" + hash.starknetKeccak("balance_of").toString(16);

const PROVIDERS = [
  "https://starknet-sepolia-rpc.publicnode.com",
  "https://starknet-sepolia.drpc.org",
  "https://starknet-sepolia.api.onfinality.io/public",
];

for (const url of PROVIDERS) {
  console.log(`\n=== ${url} ===`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: [
          {
            contract_address: STRK,
            entry_point_selector: SEL,
            calldata: [address],
          },
          "latest",
        ],
      }),
    });
    const json = await res.json();
    console.log(JSON.stringify(json).slice(0, 400));
    if (json.result) {
      const low = BigInt(json.result[0]);
      const high = BigInt(json.result[1] ?? 0);
      const bal = low + (high << 128n);
      console.log("decoded:", `${bal / 10n ** 18n}.${(bal % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)} STRK`);
    }
  } catch (err) {
    console.log("failed:", err.message?.slice(0, 120));
  }
}
