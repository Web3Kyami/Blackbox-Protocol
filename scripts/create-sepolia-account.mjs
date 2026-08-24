// Sepolia disposable deployer wallet bootstrap.
// Generates a fresh Starknet keypair locally, computes the prefund address
// against the verified OZ v1.0.0 account class (declared on Sepolia), and
// writes credentials ONLY into gitignored .env.local.
// Prints the PUBLIC ADDRESS only — never the private key.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ec, hash } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

// OZ Account v1.0.0 — Starknet Foundry book appendix (mainnet+sepolia declared)
const OZ_ACCOUNT_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

const envPath = new URL("../.env.local", import.meta.url);

function upsertEnv(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const entry = `${key}=${value}`;
  if (idx >= 0) lines[idx] = entry;
  else lines.push(entry);
}

const privBytes = ec.starkCurve.utils.randomPrivateKey();
const privateKey = "0x" + Buffer.from(privBytes).toString("hex");
const publicKey = ec.starkCurve.getStarkKey(privateKey);
const address = hash.calculateContractAddressFromHash(
  "0x0",
  OZ_ACCOUNT_CLASS_HASH,
  [publicKey],
  "0x0",
);
const addressHex = "0x" + BigInt(address).toString(16);

let lines = [];
if (existsSync(envPath)) {
  lines = readFileSync(envPath, "utf8").split(/\r?\n/);
}
upsertEnv(lines, "STARKNET_ACCOUNT_ADDRESS", addressHex);
upsertEnv(lines, "STARKNET_PRIVATE_KEY", privateKey);
upsertEnv(lines, "# Network: sepolia", "");
writeFileSync(envPath, lines.join("\n") + "\n");

console.log("=== Disposable Sepolia deployer wallet created ===");
console.log("");
console.log("FUND THIS ADDRESS (faucet / bridge):");
console.log(addressHex);
console.log("");
console.log("Account class: OZ v1.0.0");
console.log("Class hash:   ", OZ_ACCOUNT_CLASS_HASH);
console.log("Salt:         ", "0x0 (deploy_account ready)");
console.log("");
console.log("Credentials written to .env.local (gitignored). Private key NOT printed.");
