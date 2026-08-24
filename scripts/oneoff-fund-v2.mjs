// One-off: transfer STRK from the v1 burner (backup creds) to the v2 burner.
// Reads both keypairs from files; prints tx hash. Never logs keys.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, hash } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const parse = (p) => Object.fromEntries(
  readFileSync(p, "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#") && !l.trim().startsWith("Network"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const oldEnv = parse(join(ROOT, ".local", "burner-v1-backup.env"));
const newEnv = parse(join(ROOT, ".env.local"));

const provider = new RpcProvider({ nodeUrl: "https://starknet-sepolia.g.alchemy.com/v2/" + process.env.ALCHEMY_KEY });
const envKey = parse(join(ROOT, ".env.local"));
const RPC = `https://starknet-sepolia.g.alchemy.com/v2/${envKey.ALCHEMY_API_KEY}`;
const providerA = new RpcProvider({ nodeUrl: RPC });

const oldAccount = new Account({ provider: providerA, address: oldEnv.STARKNET_ACCOUNT_ADDRESS, signer: oldEnv.STARKNET_PRIVATE_KEY });
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const sel = "transfer"; // SDK hashes entrypoint names itself (starknetKeccak)
const AMOUNT = 5n * 10n ** 17n; // 0.5 STRK — enough to later deploy_account (~0.005)

const res = await oldAccount.execute([
  { contractAddress: STRK, entrypoint: sel, calldata: [newEnv.STARKNET_ACCOUNT_ADDRESS, AMOUNT, 0n] },
]);
console.log("tx:", res.transaction_hash);
await providerA.waitForTransaction(res.transaction_hash);
console.log("confirmed");
