// Probe: does native fee estimation work through Alchemy for the Arena declare?
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  RpcProvider,
  hash,
  ETransactionVersion,
} from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const RPC = `https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
const provider = new RpcProvider({ nodeUrl: RPC });
const admin = new Account({
  provider,
  address: env.STARKNET_ACCOUNT_ADDRESS,
  signer: env.STARKNET_PRIVATE_KEY,
});

const artifacts = {
  class: JSON.parse(readFileSync(join(ROOT, "contracts/target/dev/blackbox_arena_contracts_Arena.contract_class.json"), "utf8")),
  casm: JSON.parse(readFileSync(join(ROOT, "contracts/target/dev/blackbox_arena_contracts_Arena.compiled_contract_class.json"), "utf8")),
};

console.log("estimating arena declare via Alchemy...");
try {
  const est = await admin.estimateDeclareFee(
    { contract: artifacts.class, casm: artifacts.casm },
    { tip: 2_000_000_000_000n },
  );
  console.log("ESTIMATE OK:");
  console.log(JSON.stringify(est.resourceBounds ?? est, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log("overall:", (Number(est.overall_fee ?? 0n) / 1e18).toFixed(4), "STRK");
} catch (err) {
  const b = `${err?.data ?? ""} ${err?.message ?? ""}`;
  console.log("ESTIMATE FAILED:", b.slice(0, 400));
}
