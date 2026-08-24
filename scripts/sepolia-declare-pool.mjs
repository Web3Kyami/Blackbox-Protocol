// Declares the privacy pool class on Sepolia via RAW signed transaction,
// bypassing starknet.js high-level Account.declare (which requires
// getBlockWithTxHashes — unsupported on some providers — and whose
// estimator chokes on others).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Signer,
  stark,
  hash,
  ETransactionVersion,
  EDataAvailabilityMode,
} from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";
import { gzipSync } from "node:zlib";

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

const READ_RPC = "https://starknet-sepolia-rpc.publicnode.com"; // nonce reads
const SUBMIT_RPCS = [
  "https://starknet-sepolia.drpc.org",
  "https://rpc.starknet-testnet.lava.build",
  "https://free-rpc.nethermind.io/sepolia-mainnet",
];

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return res.json();
}

const address = env.STARKNET_ACCOUNT_ADDRESS;
const privateKey = env.STARKNET_PRIVATE_KEY;
const CHAIN_ID = "0x534e5f5345504f4c4941";

const artifacts = {
  class: JSON.parse(readFileSync(join(ROOT, "_research/starknet-privacy/target/dev/privacy_Privacy.contract_class.json"), "utf8")),
  casm: JSON.parse(readFileSync(join(ROOT, "_research/starknet-privacy/target/dev/privacy_Privacy.compiled_contract_class.json"), "utf8")),
};

const compiledClassHash = hash.computeCompiledClassHash(artifacts.casm);
const classHash = hash.computeSierraContractClassHash(artifacts.class);
console.log("pool compiled class hash:", compiledClassHash);
console.log("pool sierra class hash:  ", classHash);

// Already declared?
const cls = await rpc(READ_RPC, "starknet_getClassByHash", ["pending", compiledClassHash]).catch(() => null);
const clsLatest = await rpc(READ_RPC, "starknet_getClassByHash", ["latest", compiledClassHash]).catch(() => null);
if ((cls?.result ?? clsLatest?.result)?.class_hash) {
  console.log("POOL_ALREADY_DECLARED:", compiledClassHash);
  process.exit(0);
}
// getClassByHash may be unsupported on some nodes — fall through and let
// the declare attempt decide.

const nonceRes = await rpc(READ_RPC, "starknet_getNonce", ["latest", address]);
const nonce = BigInt(nonceRes.result ?? "0x0");
console.log("nonce:", nonce.toString());

// Gas prices (fri) from block header, with margin
const bn = await rpc(READ_RPC, "starknet_blockNumber", []);
const blk = await rpc(READ_RPC, "starknet_getBlockWithTxHashes", [{ block_number: bn.result }]);
const asFri = (v) => BigInt(typeof v === "object" ? v.price_in_fri : v);
const p1 = asFri(blk.result.l1_gas_price);
const pd = asFri(blk.result.l1_data_gas_price);
const p2 = asFri(blk.result.l2_gas_price);
const resourceBounds = {
  l1_gas: { max_amount: 15_000n, max_price_per_unit: p1 * 2n },
  l1_data_gas: { max_amount: 4_000_000n, max_price_per_unit: pd * 2n },
  l2_gas: { max_amount: 80_000_000n, max_price_per_unit: p2 * 3n },
};
const worst =
  resourceBounds.l1_gas.max_amount * resourceBounds.l1_gas.max_price_per_unit +
  resourceBounds.l1_data_gas.max_amount * resourceBounds.l1_data_gas.max_price_per_unit +
  resourceBounds.l2_gas.max_amount * resourceBounds.l2_gas.max_price_per_unit;
console.log(`worst-case fee: ${(Number(worst) / 1e18).toFixed(2)} STRK`);

const TIP = 2n * 10n ** 12n;

const signer = new Signer(privateKey);
const signature = await signer.signDeclareTransaction({
  classHash,
  compiledClassHash,
  senderAddress: address,
  chainId: CHAIN_ID,
  nonce,
  version: ETransactionVersion.V3,
  resourceBounds,
  tip: TIP,
  paymasterData: [],
  accountDeploymentData: [],
  nonceDataAvailabilityMode: EDataAvailabilityMode.L1,
  feeDataAvailabilityMode: EDataAvailabilityMode.L1,
});

const body = {
  type: "DECLARE",
  sender_address: address,
  compiled_class_hash: compiledClassHash,
  // Newer RPC specs require abi as a JSON-encoded string, not an array.
  contract_class: { ...artifacts.class, abi: JSON.stringify(artifacts.class.abi ?? []) },
  signature: stark.formatSignature(signature),
  nonce: "0x" + nonce.toString(16),
  resource_bounds: {
    l1_gas: {
      max_amount: "0x" + resourceBounds.l1_gas.max_amount.toString(16),
      max_price_per_unit: "0x" + resourceBounds.l1_gas.max_price_per_unit.toString(16),
    },
    l1_data_gas: {
      max_amount: "0x" + resourceBounds.l1_data_gas.max_amount.toString(16),
      max_price_per_unit: "0x" + resourceBounds.l1_data_gas.max_price_per_unit.toString(16),
    },
    l2_gas: {
      max_amount: "0x" + resourceBounds.l2_gas.max_amount.toString(16),
      max_price_per_unit: "0x" + resourceBounds.l2_gas.max_price_per_unit.toString(16),
    },
  },
  tip: "0x" + TIP.toString(16),
  paymaster_data: [],
  account_deployment_data: [],
  nonce_data_availability_mode: "L1",
  fee_data_availability_mode: "L1",
  version: "0x3",
};

let submitted = false;
const payload = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "starknet_addDeclareTransaction",
  params: { declare_transaction: body },
});
const gzipped = gzipSync(Buffer.from(payload, "utf8"));
console.log(`payload size: ${(Buffer.byteLength(payload) / 1024).toFixed(0)} KB raw, ${(gzipped.length / 1024).toFixed(0)} KB gzip`);

for (let attempt = 1; attempt <= 3 && !submitted; attempt++) {
  for (const url of SUBMIT_RPCS) {
    console.log(`[submit] try ${attempt}: ${url} ...`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
        body: gzipped,
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        console.log(`[submit] non-JSON response (${res.status}): ${text.slice(0, 120)}`);
        continue;
      }
      console.log(JSON.stringify(json).slice(0, 300));
      if (json.error) {
        // Full error needed to diagnose bounds rejections
        console.log("[full-error]", JSON.stringify(json.error).slice(0, 1200));
      }
      if (json.result?.transaction_hash) {
        console.log("DECLARE_TX:", json.result.transaction_hash);
        console.log("CLASS_HASH:", compiledClassHash);
        submitted = true;
        break;
      }
      if (/nonce/i.test(JSON.stringify(json))) {
        // Nonce collision means a prior "timeout" actually landed — recheck chain
        const check = await rpc(READ_RPC, "starknet_getClassByHash", ["latest", compiledClassHash]);
        if (check?.result?.class_hash) {
          console.log("CLASS_PRESENT:", compiledClassHash);
          submitted = true;
          break;
        }
      }
    } catch (err) {
      console.log(`[submit] ${url}: ${err.message?.slice(0, 80)}`);
    }
  }
  if (!submitted && attempt < 3) {
    // Did an earlier timed-out attempt actually land?
    const check = await rpc(READ_RPC, "starknet_getClassByHash", ["latest", compiledClassHash]);
    if (check?.result?.class_hash) {
      console.log("CLASS_PRESENT (late confirmation):", compiledClassHash);
      submitted = true;
    } else {
      console.log("[submit] not landed yet; retrying round...");
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}
if (!submitted) process.exit(1);

// Wait for inclusion via the read RPC
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const rec = await rpc(READ_RPC, "starknet_getTransactionReceipt", [body.nonce === undefined ? "" : ""]).catch(() => null);
  // receipt lookup needs the hash — refetch from submit log instead; simple poll on class presence:
  const present = await rpc(READ_RPC, "starknet_getClassByHash", ["latest", compiledClassHash]);
  if (present?.result?.class_hash) {
    console.log("CONFIRMED: class present on chain");
    break;
  }
  console.log(`waiting... (${i + 1})`);
}
