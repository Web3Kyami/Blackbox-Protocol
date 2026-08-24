// Phase 7 Step 2: Full Blackbox Arena deployment to Starknet Sepolia.
// Declares + deploys prize token, privacy pool (self-governed instance),
// Arena, ArenaAdapter; locks adapter; sets sponsor price; funds escrow;
// registers default strategies. Saves evidence to .local/sepolia-round.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  RpcProvider,
  hash,
  encode,
} from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

// Pedersen on felts (mirrors SDK Deployer's starkCurve.pedersen usage).
const { addHexPrefix } = encode;
let _pedersen = null;
async function pedersen(a, b) {
  if (!_pedersen) {
    const mod = await import("../_research/starknet-privacy/e2e/node_modules/@scure/starknet/lib/esm/index.js");
    _pedersen = mod.pedersen;
  }
  return _pedersen(BigInt(a), BigInt(b));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RESEARCH = join(ROOT, "_research", "starknet-privacy");
const CONTRACTS_DEV = join(ROOT, "contracts", "target", "dev");

// ── Credentials ───────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const RPC = env.ALCHEMY_API_KEY
  ? `https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
  : env.SEPOLIA_RPC_URL || "https://starknet-sepolia-rpc.publicnode.com";
const PRICE_RPC = "https://starknet-sepolia-rpc.publicnode.com"; // block headers w/ gas prices

const provider = new RpcProvider({ nodeUrl: RPC });
const chainId = await provider.getChainId();
if (chainId !== "0x534e5f5345504f4c4941") throw new Error(`Wrong network ${chainId}`);
const admin = new Account({
  provider,
  address: env.STARKNET_ACCOUNT_ADDRESS,
  signer: env.STARKNET_PRIVATE_KEY,
});
console.log(`[net] SN_SEPOLIA via ${RPC}`);
console.log(`[admin] ${admin.address}`);

// ── Screening signer public key (canonical test key from SDK testing kit) ────
const screeningMod = await import(join(RESEARCH, "sdk", "dist", "testing", "screening-signer.js"));
const SCREENING_PUB = "0x" + screeningMod.SCREENING_SIGNER_PUBLIC_KEY.toString(16);

// Manual resource bounds: some Sepolia RPCs cannot estimate V3 fees
// ("Insufficient transaction data"). We read current gas prices ourselves,
// apply safety multipliers, and cap totals within our STRK budget.
const BUDGET_FRI = 15n * 10n ** 18n; // per-tx worst-case cap (balance-safe)
let _cachedBounds = null;
async function getResourceBounds() {
  if (_cachedBounds) return _cachedBounds;
  const raw = async (method, params) => {
    const res = await fetch(PRICE_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return res.json();
  };
  const bn = await raw("starknet_blockNumber", []);
  const blk = await raw("starknet_getBlockWithTxHashes", [{ block_number: bn.result }]);
  const asFri = (v) => BigInt(typeof v === "object" ? v.price_in_fri ?? v.fri ?? 0 : v);
  const p1 = asFri(blk.result.l1_gas_price);
  const pd = asFri(blk.result.l1_data_gas_price ?? blk.result.l1_gas_price);
  const p2 = asFri(blk.result.l2_gas_price ?? blk.result.l1_gas_price);
  console.log(`[gas] l1=${p1} l1_data=${pd} l2=${p2} fri/unit`);
  // Generous amounts; shrink price multipliers until worst case fits budget.
  const amounts = { l1: 20_000n, dat: 4_000_000n, l2: 80_000_000n };
  let m1 = 8n, md = 12n, m2 = 16n;
  const worst = () => amounts.l1 * p1 * m1 + amounts.dat * pd * md + amounts.l2 * p2 * m2;
  const MIN_M = 3n;
  while ((worst() > BUDGET_FRI || m1 < MIN_M || md < MIN_M || m2 < MIN_M) && (m2 > MIN_M || m1 > MIN_M || md > MIN_M)) {
    if (m2 > MIN_M) m2 /= 2n;
    if (m1 > MIN_M) m1 /= 2n;
    if (md > MIN_M) md /= 2n;
    if (m1 === MIN_M && md === MIN_M && m2 === MIN_M) break;
  }
  if (m1 < MIN_M) m1 = MIN_M;
  if (md < MIN_M) md = MIN_M;
  if (m2 < MIN_M) m2 = MIN_M;
  console.log(`[gas] multipliers x${m1}/x${md}/x${m2} -> worst-case ${(Number(worst()) / 1e18).toFixed(2)} STRK`);
  _cachedBounds = {
    l1_gas: { max_amount: amounts.l1, max_price_per_unit: p1 * m1 },
    l1_data_gas: { max_amount: amounts.dat, max_price_per_unit: pd * md },
    l2_gas: { max_amount: amounts.l2, max_price_per_unit: p2 * m2 },
  };
  return _cachedBounds;
}

// Raw Alchemy fee estimation (D016 technique): starknet_estimateFee with
// named params { request: [tx], block_id: "latest", simulation_flags: ["SKIP_VALIDATE"] }.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rawEstimateFee(txObject) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "starknet_estimateFee",
    params: { request: [txObject], block_id: "latest", simulation_flags: ["SKIP_VALIDATE"] },
  };
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { data: json.error.data });
  const r = json.result[0];
  return {
    l1_gas: BigInt(r.l1_gas_consumed),
    l1_data_gas: BigInt(r.l1_data_gas_consumed),
    l2_gas: BigInt(r.l2_gas_consumed),
    overall_fee: BigInt(r.overall_fee),
  };
}

// Build a V3 INVOKE tx skeleton for estimation (zeroed bounds, real nonce/tip).
// NOTE: every felt must be a 0x-prefixed hex string — Alchemy rejects decimals.
async function estimateTxObject(calls) {
  const nonce = await admin.getNonce();
  return {
    type: "INVOKE",
    sender_address: admin.address,
    calldata: [
      "0x" + calls.length.toString(16), // number of calls in the multicall
      ...calls.flatMap((c) => [
        c.contractAddress,
        "0x" + (typeof c.entrypoint === "string" && !c.entrypoint.startsWith("0x")
          ? hash.starknetKeccak(c.entrypoint)
          : BigInt(c.entrypoint)).toString(16),
        "0x" + BigInt(c.calldata.length).toString(16),
        ...c.calldata.map((v) => "0x" + BigInt(v).toString(16)),
      ]),
    ],
    signature: [],
    nonce: "0x" + BigInt(nonce).toString(16),
    resource_bounds: {
      l2_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
      l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
      l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
    },
    tip: "0x" + TIP_FRI.toString(16),
    paymaster_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode: "L1",
    account_deployment_data: [],
    version: "0x100000000000000000000000000000003",
  };
}

// Warm the V3 tip market: the node-side estimator requires >= 10 recent
// tipped transactions. Submit tiny self-transfers with escalating tips.
const STRK_TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
async function warmTipMarket() {
  if (state.tipMarketWarmed) {
    console.log("[warmup] tip market already warmed in prior run");
    return;
  }
  console.log("[warmup] priming V3 tip market with 10 micro-transfers...");
  const b = await getResourceBounds();
  // Deliberately tiny: validator appears to charge SUM(amounts) x MAX(price).
  const bounds = {
    l1_gas: { max_amount: 200n, max_price_per_unit: BigInt(b.l1_gas.max_price_per_unit) },
    l1_data_gas: { max_amount: 2_500n, max_price_per_unit: BigInt(b.l1_data_gas.max_price_per_unit) },
    l2_gas: { max_amount: 900_000n, max_price_per_unit: BigInt(b.l2_gas.max_price_per_unit) },
  };
  for (let i = 0; i < 10; i++) {
    const tx = await admin.execute(
      [
        {
          contractAddress: STRK_TOKEN,
          entrypoint: selectorOf("transfer"),
          calldata: [admin.address, 1_000n, 0n], // 1e-15 STRK to self
        },
      ],
      { resourceBounds: bounds, tip: 100_000_000_000n },
    );
    await provider.waitForTransaction(tx.transaction_hash);
    console.log(`[warmup] ${i + 1}/10 confirmed`);
  }
  state.tipMarketWarmed = true;
  saveState();
  console.log("[warmup] done");
}

// ── Measured-bounds submission ────────────────────────────────────────────────
// Node-side fee estimation is unreliable here, BUT the account validator
// rejects under-sized transactions while reporting EXACT consumption:
//   'Insufficient max L2Gas: max amount: X, actual used: Y'
// So we submit, learn real usage, raise bounds, and retry until included.
function parseActualUsed(blob) {
  const out = {};
  const re = /(L1Gas|L1DataGas|L2Gas):\s*max amount:\s*\d+,\s*actual used:\s*(\d+)/gi;
  let m;
  while ((m = re.exec(blob)) !== null) {
    const key = m[1].toLowerCase() === "l1gas" ? "l1_gas" : m[1].toLowerCase() === "l1datagas" ? "l1_data_gas" : "l2_gas";
    out[key] = BigInt(m[2]);
  }
  return out;
}

async function submitMeasured(opName, send, estimateCallsOrDeclare) {
  // Alchemy-native estimation (D016): raw starknet_estimateFee returns exact
  // consumption; apply a safety margin to amounts + prices, submit once.
  const prices = await getResourceBounds();
  let consumed; let declareBounds;
  declareBounds = null;
  if (estimateCallsOrDeclare?.declare) {
    const est = await admin.estimateDeclareFee(
      { contract: estimateCallsOrDeclare.contract, casm: estimateCallsOrDeclare.casm },
      { tip: TIP_FRI },
    );
    // SDK resourceBounds are authoritative — they encode the sequencer's effective
    // price (which can be far above block-header prices). Use them verbatim +5%.
    const rb = est.resourceBounds;
    declareBounds = {
      l1_gas: { max_amount: rb.l1_gas.max_amount, max_price_per_unit: (BigInt(rb.l1_gas.max_price_per_unit) * 105n) / 100n },
      l1_data_gas: { max_amount: rb.l1_data_gas.max_amount, max_price_per_unit: (BigInt(rb.l1_data_gas.max_price_per_unit) * 105n) / 100n },
      l2_gas: { max_amount: rb.l2_gas.max_amount, max_price_per_unit: (BigInt(rb.l2_gas.max_price_per_unit) * 105n) / 100n },
    };
    consumed = {
      l1_gas: BigInt(declareBounds.l1_gas.max_amount),
      l1_data_gas: BigInt(declareBounds.l1_data_gas.max_amount),
      l2_gas: BigInt(declareBounds.l2_gas.max_amount),
    };
  } else {
    const txObj = await estimateTxObject(estimateCallsOrDeclare);
    consumed = await rawEstimateFee(txObj);
  }
  // EXPERIMENT D016b: exact amounts + exact market prices (no margin) to isolate
  // the account-validation failure. If under-sized, execution reports actual usage.
  // D016d: EXACT estimate amounts + market-exact prices (the only config the sequencer
  // accepted in dep5). Drift between quote and submit causes 'price lower than actual'
  // rejections — handled by a tight retry loop that re-quotes and resubmits.
  const mkt = (x) => (BigInt(x) / 3n * 105n) / 100n; // market +5% headroom vs drifting threshold
  // Estimation (SKIP_VALIDATE) understates usage — measured deploy revert showed ~+10.5%.
  // Apply x1.3 amounts to cover account-validation gas.
  // FEE-TIGHT MODE. Declares: use SDK's authoritative resourceBounds directly.
  const bounds = declareBounds ?? {
    l1_gas: { max_amount: (consumed.l1_gas * 115n) / 100n + 10n, max_price_per_unit: mkt(prices.l1_gas.max_price_per_unit) },
    l1_data_gas: { max_amount: (consumed.l1_data_gas * 115n) / 100n + 10n, max_price_per_unit: mkt(prices.l1_data_gas.max_price_per_unit) },
    l2_gas: { max_amount: (consumed.l2_gas * 115n) / 100n + 1000n, max_price_per_unit: mkt(prices.l2_gas.max_price_per_unit) },
  };
  // Sequencer admission requires worst-case <= balance. The x3-multiplied
  // prices from getResourceBounds blow past it on big declares, so collapse
  // to market-exact prices when the reserve would exceed a balance-safe cap.
  const BALANCE_CAP = 500n * 10n ** 18n; // v2 burner holds 3k STRK — generous reserve OK
  let worst =
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit +
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit;
  if (worst > BALANCE_CAP) {
    console.log(`[${opName}] reserve ${Number(worst) / 1e18} STRK > cap — collapsing prices to raw market`);
    // prices.* are already x3-multiplied inside getResourceBounds; divide out to raw market.
    bounds.l1_gas.max_price_per_unit = (BigInt(prices.l1_gas.max_price_per_unit) / 3n * 11n) / 10n;
    bounds.l1_data_gas.max_price_per_unit = (BigInt(prices.l1_data_gas.max_price_per_unit) / 3n * 11n) / 10n;
    bounds.l2_gas.max_price_per_unit = (BigInt(prices.l2_gas.max_price_per_unit) / 3n * 11n) / 10n;
    worst =
      bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
      bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit +
      bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit;
  }
  console.log(
    `[${opName}] estimated (l1=${consumed.l1_gas}, da=${consumed.l1_data_gas}, l2=${consumed.l2_gas}); ` +
      `worst-case ${(Number(worst) / 1e18).toFixed(3)} STRK`,
  );
    console.log(
    `[${opName}] estimated (l1=${consumed.l1_gas}, da=${consumed.l1_data_gas}, l2=${consumed.l2_gas}); ` +
      `worst-case ${(Number(worst) / 1e18).toFixed(3)} STRK`,
  );
    // Retry on price-drift/fee rejections: re-quote fresh (declare-aware) and resubmit.
  let lastErr = null;
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      return await send(bounds);
    } catch (err) {
      lastErr = err;
      const blob = `${err?.data ?? ""} ${JSON.stringify(err?.data ?? "")} ${err?.message ?? ""}`;
      if (/lower than the actual gas price|exceed balance|below the required threshold/i.test(blob)) {
        try {
          if (estimateCallsOrDeclare?.declare) {
            const est = await admin.estimateDeclareFee(
              { contract: estimateCallsOrDeclare.contract, casm: estimateCallsOrDeclare.casm },
              { tip: TIP_FRI },
            );
            const rb = est.resourceBounds;
            bounds.l1_gas.max_amount = rb.l1_gas.max_amount;
            bounds.l1_data_gas.max_amount = rb.l1_data_gas.max_amount;
            bounds.l2_gas.max_amount = rb.l2_gas.max_amount;
            bounds.l1_gas.max_price_per_unit = (BigInt(rb.l1_gas.max_price_per_unit) * 11n) / 10n;
            bounds.l1_data_gas.max_price_per_unit = (BigInt(rb.l1_data_gas.max_price_per_unit) * 11n) / 10n;
            bounds.l2_gas.max_price_per_unit = (BigInt(rb.l2_gas.max_price_per_unit) * 11n) / 10n;
          } else {
            const fp = await getResourceBounds();
            const fc = await rawEstimateFee(await estimateTxObject(estimateCallsOrDeclare));
            bounds.l1_gas.max_amount = fc.l1_gas; bounds.l1_data_gas.max_amount = fc.l1_data_gas; bounds.l2_gas.max_amount = fc.l2_gas;
            bounds.l1_gas.max_price_per_unit = BigInt(fp.l1_gas.max_price_per_unit) / 3n;
            bounds.l1_data_gas.max_price_per_unit = BigInt(fp.l1_data_gas.max_price_per_unit) / 3n;
            bounds.l2_gas.max_price_per_unit = BigInt(fp.l2_gas.max_price_per_unit) / 3n;
          }
          console.log(`[${opName}] fee reject — requoted fresh (attempt ${attempt})`);
        } catch (qErr) {
          console.log(`[${opName}] requote failed: ${String(qErr?.message ?? qErr).slice(0,80)}`);
        }
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
async function ensureDeclared(label) {
  const compiledClassHash = hash.computeCompiledClassHash(artifacts[label].casm);
  try {
    await provider.getClassByHash(compiledClassHash);
    console.log(`[declare] ${label}: already declared (${compiledClassHash})`);
    return compiledClassHash;
  } catch {
    // not declared yet
  }
  console.log(`[declare] ${label}: submitting DECLARE...`);
  let res;
  try {
    res = await submitMeasured(
      `declare:${label}`,
      (bounds) =>
        admin.declare(
          { contract: artifacts[label].class, casm: artifacts[label].casm },
          { resourceBounds: bounds, tip: TIP_FRI },
        ),
      { declare: true, contract: artifacts[label].class, casm: artifacts[label].casm },
    );
  } catch (err) {
    const blob = `${err?.data ?? ""} ${JSON.stringify(err?.data ?? "")} ${err?.message ?? ""}`;
    if (/is already declared/i.test(blob)) {
      const match = /Class with hash (0x[0-9a-fA-F]+) is already declared/.exec(blob);
      console.log(`[declare] ${label}: already declared (${match?.[1] ?? compiledClassHash})`);
      return match ? match[1] : compiledClassHash;
    }
    throw err;
  }
  await provider.waitForTransaction(res.transaction_hash);
  console.log(`[declare] ${label}: ${res.class_hash} (tx ${res.transaction_hash})`);
  return res.class_hash;
}

// ── Artifacts ─────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const artifacts = {
  token: {
    class: readJson(join(RESEARCH, "e2e/contracts/test-token/target/dev/test_token_TestToken.contract_class.json")),
    casm: readJson(join(RESEARCH, "e2e/contracts/test-token/target/dev/test_token_TestToken.compiled_contract_class.json")),
  },
  pool: {
    class: readJson(join(RESEARCH, "target/dev/privacy_Privacy.contract_class.json")),
    casm: readJson(join(RESEARCH, "target/dev/privacy_Privacy.compiled_contract_class.json")),
  },
  arena: {
    class: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_Arena.contract_class.json")),
    casm: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_Arena.compiled_contract_class.json")),
  },
  adapter: {
    class: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_ArenaAdapter.contract_class.json")),
    casm: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_ArenaAdapter.compiled_contract_class.json")),
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const selectorOf = (name) => "0x" + hash.starknetKeccak(name).toString(16);

async function deployContract(classHash, constructorCalldata, label, salt = "0x0") {
  console.log(`[deploy] ${label}...`);
  // SDK default deployer: new UDC (v2) at 0x02ceed... with entrypoint deploy_contract.
  const UDC_ADDRESS = "0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125";
  const UDC_ENTRYPOINT = selectorOf("deploy_contract");
  // Predicted address mirrors SDK Deployer: unique=true -> salt' = pedersen(account, salt),
  // deployer (UDC) address as deployment-hash prefix.
  const uniqueSalt = "0x" + BigInt(await pedersen(BigInt(admin.address), BigInt(salt))).toString(16);
  const computed =
    "0x" +
    BigInt(
      hash.calculateContractAddressFromHash(
        uniqueSalt,
        classHash,
        constructorCalldata,
        UDC_ADDRESS,
      ),
    ).toString(16);
  if (await contractLive(computed)) {
    console.log(`[deploy] ${label}: already live at ${computed}`);
    return computed;
  }
  const res = await submitMeasured(
    `deploy:${label}`,
    (bounds) =>
      admin.deployContract(
        { classHash, constructorCalldata, salt },
        { resourceBounds: bounds, tip: TIP_FRI },
      ),
    [
      {
        contractAddress: UDC_ADDRESS,
        entrypoint: "deploy_contract",
        // UDC v2 layout: classHash, salt, from_zero(0=unique), calldata_len, ...calldata
        calldata: [
          classHash,
          salt,
          "0x1", // unique = true
          "0x" + constructorCalldata.length.toString(16),
          ...constructorCalldata.map((v) => "0x" + BigInt(v).toString(16)),
        ],
      },
    ],
  );
  console.log(`[deploy] ${label}: tx ${res.transaction_hash} — waiting...`);
  await provider.waitForTransaction(res.transaction_hash);
  try {
    const rcpt = await provider.getTransactionReceipt(res.transaction_hash);
    const fee = rcpt.actual_fee ? Number(BigInt(rcpt.actual_fee.amount ?? rcpt.actual_fee)) / 1e18 : 0;
    console.log(`[deploy] ${label}: fee=${fee.toFixed(4)} STRK status=${rcpt.execution_status}`);
  } catch {}
  const rcpt = await provider.getTransactionReceipt(res.transaction_hash);
  if (rcpt.revert_reason) {
    console.log(`[deploy] ${label}: REVERTED: ${rcpt.revert_reason}`);
    throw new Error(`[deploy] ${label}: reverted: ${rcpt.revert_reason}`);
  }
  // Verify actually live — waitForTransaction can return on REVERTED receipts.
  for (let check = 0; check < 10; check++) {
    if (await contractLive(computed)) {
      console.log(`[deploy] ${label}: ${computed} (tx ${res.transaction_hash})`);
      return computed;
    }
    console.log(`[deploy] ${label}: tx included but address not live (reverted?) — redeploying (${check + 1})`);
    break;
  }
  throw new Error(`[deploy] ${label}: deployed at ${computed} but contract is not live — likely reverted. Aborting for diagnosis.`);
}

function serializeByteArray(value) {
  const bytes = Buffer.from(value, "utf8");
  const nFull = Math.floor(bytes.length / 31);
  const data = [];
  for (let i = 0; i < nFull; i++) {
    data.push("0x" + bytes.subarray(i * 31, (i + 1) * 31).toString("hex"));
  }
  const rem = bytes.subarray(nFull * 31);
  let pendingWord = "0x0";
  let pendingLen = 0;
  if (rem.length > 0) {
    pendingWord = "0x" + rem.toString("hex");
    pendingLen = rem.length;
  }
  return [data.length, ...data, pendingWord, pendingLen];
}

function canonicalizeRules(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeRules).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeRules(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

// ── Round parameters ──────────────────────────────────────────────────────────
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const START_OFFSET_SEC = argOf("--start-offset", 180);
const ROUND_SECONDS = argOf("--round-seconds", 720);
const TIP_FRI = 2n * 10n ** 12n; // raised: 2e12 got evicted from mempool (TTL)

// ── Resumable state ───────────────────────────────────────────────────────────
mkdirSync(join(ROOT, ".local"), { recursive: true });
const STATE_FILE = join(ROOT, ".local", "sepolia-round.json");
let state = {};
if (existsSync(STATE_FILE)) {
  state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  console.log(`[resume] found prior state (${state.status ?? "partial"})`);
}
function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function contractLive(address) {
  try {
    await provider.getClassAt(address);
    return true;
  } catch {
    return false;
  }
}

const nowSec = Math.floor(Date.now() / 1000);
const startTime = BigInt(nowSec + START_OFFSET_SEC);
const endTime = startTime + BigInt(ROUND_SECONDS);
const MOCK_TARGET = "0x123456789";
const PRICE_18 = BigInt("1000000000000000000");

// PART2_MARKER

// ── 0. Warm the V3 tip market so node-side estimation works ──────────────────
await warmTipMarket();

// ── 1. Prize token ────────────────────────────────────────────────────────────
const tokenClassHash = await ensureDeclared("token");
let usdToken = state.addresses?.usdToken;
if (usdToken && (await contractLive(usdToken))) {
  console.log(`[resume] Prize token live at ${usdToken}`);
} else {
  usdToken = await deployContract(
    tokenClassHash,
    [...serializeByteArray("BlackUSD"), ...serializeByteArray("BUSD")],
    "Prize token (TestUSD)",
  );
}
state.addresses = { ...(state.addresses ?? {}), usdToken };
saveState();

// ── 2. Privacy pool — D014 superseded: balance now supports declare ──────────
// D016: pool self-declaration not viable on Sepolia (surge gate). Permanently skipped.
let privacyPool = null;
console.log("[pool] skipped per D016 — shielded actions Devnet-proven only");

// ── 3. Arena ──────────────────────────────────────────────────────────────────
const rulesParams = {
  startTime,
  endTime,
  startingUnits: 1000n,
  maxAllocationBps: 3500,
  maxDrawdownBps: 2000,
  prizeCapUnits: 100n,
  allowedAssets: [usdToken],
  allowedTargets: [MOCK_TARGET],
};
const canonical = canonicalizeRules(rulesParams);
const rulesCommitment = "0x" + createHash("sha256").update(canonical).digest("hex").slice(0, 62);
console.log(`[rules] canonical JSON: ${canonical}`);
console.log(`[rules] commitment: ${rulesCommitment}`);

const arenaClassHash = await ensureDeclared("arena");
let arena = state.addresses?.arena;
// Invalidate stale arena from a prior run whose round window differs from this run's.
if (arena && state.roundParams && (String(state.roundParams.startTime) !== startTime.toString())) {
  console.log(`[stale] arena ${arena} belongs to an expired window — redeploying`);
  arena = undefined;
}
if (!(arena && (await contractLive(arena)))) {
  arena = await deployContract(arenaClassHash, [
    admin.address,
    startTime,
    endTime,
    1000n,
    3500n,
    2000n,
    100n,
    usdToken, // prize_token
    1n, usdToken, // initial_assets span
    1n, MOCK_TARGET, // initial_targets span
    BigInt(rulesCommitment),
  ], "Arena");
}
state.addresses = { ...(state.addresses ?? {}), arena };
state.roundParams = { startTime: startTime.toString(), endTime: endTime.toString() };
saveState();

// ── 4. Adapter + one-time lock ───────────────────────────────────────────────
const adapterClassHash = await ensureDeclared("adapter");
let adapter = state.addresses?.adapter;
if (!(adapter && (await contractLive(adapter)))) {
  const poolArg = privacyPool;
  adapter = await deployContract(adapterClassHash, [poolArg, arena], "ArenaAdapter");
}
state.addresses = { ...(state.addresses ?? {}), adapter };
saveState();

// ── 5. Sponsor setup multicall (atomic, ordered, pre-start) ─────────────────
const FALCON = "0x46414c434f4e5f434f4d4d4954";
const TORTOISE = "0x544f52544f4953455f434f4d4d4954";
const PULSE = "0x50554c53455f434f4d4d4954";
const calls = [
  { contractAddress: usdToken, entrypoint: "mint", calldata: [admin.address, PRICE_18 * 10_000n, 0n] },
  { contractAddress: arena, entrypoint: "set_action_adapter", calldata: [adapter] },
  { contractAddress: arena, entrypoint: "set_price", calldata: [usdToken, PRICE_18] },
  { contractAddress: arena, entrypoint: "register_strategy", calldata: [FALCON] },
  { contractAddress: arena, entrypoint: "register_strategy", calldata: [TORTOISE] },
  { contractAddress: arena, entrypoint: "register_strategy", calldata: [PULSE] },
  { contractAddress: usdToken, entrypoint: "approve", calldata: [arena, PRICE_18 * 10_000n, 0n] },
  { contractAddress: arena, entrypoint: "deposit_prize", calldata: [100n] },
];
console.log("[setup] submitting sponsor multicall...");
const setupTx = await submitMeasured(
  "setup-multicall",
  (bounds) => admin.execute(calls, { resourceBounds: bounds, tip: TIP_FRI }),
  calls,
);
await provider.waitForTransaction(setupTx.transaction_hash);
console.log(`[setup] ok (tx ${setupTx.transaction_hash})`);

// ── 6. Evidence summary ───────────────────────────────────────────────────────
mkdirSync(join(ROOT, ".local"), { recursive: true });
const summary = {
  network: "sepolia",
  rpcUrl: RPC,
  deployedAt: new Date().toISOString(),
  sponsor: admin.address,
  addresses: {
    usdToken,
    privacyPool,
    arena,
    adapter,
  },
  rulesCommitment,
  roundParams: {
    startTime: startTime.toString(),
    endTime: endTime.toString(),
    startingUnits: "1000",
    maxAllocationBps: 3500,
    maxDrawdownBps: 2000,
    prizeCapUnits: "100",
    prizeDeposited: "100",
  },
  strategies: [
    { label: "Falcon", commitment: FALCON },
    { label: "Tortoise", commitment: TORTOISE },
    { label: "Pulse", commitment: PULSE },
  ],
  transactions: {
    setupMulticall: setupTx.transaction_hash,
  },
};
writeFileSync(join(ROOT, ".local", "sepolia-round.json"), JSON.stringify(summary, null, 2));
console.log("\n=== DEPLOYMENT SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
console.log(`\nRound starts at unix ${startTime}, ends ${endTime} (${ROUND_SECONDS}s round).`);

