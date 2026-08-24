// Deploys the Sepolia OZ v1.0.0 account via DEPLOY_ACCOUNT transaction.
// Verifies the computed address matches the funded address BEFORE submitting.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, ec, hash } from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

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
const privateKey = env.STARKNET_PRIVATE_KEY;
const RPC = "https://starknet-sepolia-rpc.publicnode.com";

// OZ Account v1.0.0 (declared on mainnet + sepolia; Starknet Foundry book)
const OZ_ACCOUNT_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

const provider = new RpcProvider({ nodeUrl: RPC });
const chainId = await provider.getChainId();
if (chainId !== "0x534e5f5345504f4c4941") {
  throw new Error(`Wrong network: ${chainId} (expected SN_SEPOLIA)`);
}

const publicKey = ec.starkCurve.getStarkKey(privateKey);

// Safety check: recomputed counterfactual address must equal the funded one
const expected = "0x" + BigInt(
  hash.calculateContractAddressFromHash("0x0", OZ_ACCOUNT_CLASS_HASH, [publicKey], "0x0"),
).toString(16);
if (BigInt(expected) !== BigInt(address)) {
  throw new Error(`Address mismatch! computed ${expected}, env ${address}`);
}
console.log("Address verified against keypair:", address);

const account = new Account({ provider, address, signer: privateKey });

console.log("Submitting DEPLOY_ACCOUNT...");
const result = await account.deployAccount({
  classHash: OZ_ACCOUNT_CLASS_HASH,
  constructorCalldata: [publicKey],
  contractAddressSalt: "0x0",
});
console.log("tx hash:", result.transaction_hash);
console.log("Waiting for confirmation...");
const receipt = await provider.waitForTransaction(result.transaction_hash);
console.log("status:", receipt.finality_status ?? receipt.status, "/", receipt.execution_status ?? "");
