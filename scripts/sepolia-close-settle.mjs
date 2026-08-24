// Phase 7 Step 4: close the Sepolia round and settle the prize to the derived winner.
// Usage: node scripts/sepolia-close-settle.mjs [--settle-amount 100]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  RpcProvider,
  hash,
} from "../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const RPC = `https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
const provider = new RpcProvider({ nodeUrl: RPC });
const admin = new Account({ provider, address: env.STARKNET_ACCOUNT_ADDRESS, signer: env.STARKNET_PRIVATE_KEY });

const state = JSON.parse(readFileSync(join(ROOT, ".local", "sepolia-round.json"), "utf8"));
const arena = state.addresses.arena;
const usdToken = state.addresses.usdToken;
const sponsor = state.sponsor;
if (!arena) throw new Error("No arena in state");

const selectorOf = (name) => "0x" + hash.starknetKeccak(name).toString(16);
const TIP_FRI = 20n * 10n ** 12n;

async function rawEstimate(calls) {
  const nonce = await admin.getNonce();
  const txObj = {
    type: "INVOKE",
    sender_address: admin.address,
    calldata: [
      "0x" + calls.length.toString(16),
      ...calls.flatMap((c) => [
        c.contractAddress,
        "0x" + hash.starknetKeccak(c.entrypoint).toString(16),
        "0x" + BigInt(c.calldata.length).toString(16),
        ...c.calldata.map((v) => "0x" + BigInt(v).toString(16)),
      ]),
    ],
    signature: [], nonce: "0x" + BigInt(nonce).toString(16),
    resource_bounds: {
      l2_gas: {max_amount:"0x0",max_price_per_unit:"0x0"},
      l1_gas:{max_amount:"0x0",max_price_per_unit:"0x0"},
      l1_data_gas:{max_amount:"0x0",max_price_per_unit:"0x0"}},
    tip: "0x" + TIP_FRI.toString(16), paymaster_data: [],
    nonce_data_availability_mode: "L1", fee_data_availability_mode: "L1",
    account_deployment_data: [], version: "0x100000000000000000000000000000003",
  };
  const res = await fetch(RPC, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({jsonrpc:"2.0",id:1,method:"starknet_estimateFee",params:{request:[txObj],block_id:"latest",simulation_flags:["SKIP_VALIDATE"]}}) });
  const j = await res.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data });
  const r = j.result[0];
  return {
    l1_gas: BigInt(r.l1_gas_consumed), l1_data_gas: BigInt(r.l1_data_gas_consumed), l2_gas: BigInt(r.l2_gas_consumed),
    prices: { l1: BigInt(r.l1_gas_price), da: BigInt(r.l1_data_gas_price), l2: BigInt(r.l2_gas_price) },
  };
}

async function submit(opName, calls) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const est = await rawEstimate(calls);
      const bounds = {
        l1_gas: { max_amount: (est.l1_gas*13n)/10n+100n, max_price_per_unit: (est.prices.l1*11n)/10n },
        l1_data_gas: { max_amount: (est.l1_data_gas*13n)/10n+100n, max_price_per_unit: (est.prices.da*11n)/10n },
        l2_gas: { max_amount: (est.l2_gas*13n)/10n+10000n, max_price_per_unit: (est.prices.l2*11n)/10n },
      };
      console.log(`[${opName}] attempt ${attempt}: est l2=${est.l2_gas}, submitting...`);
      return await admin.execute(calls, { resourceBounds: bounds, tip: TIP_FRI });
    } catch (err) {
      const blob = `${err?.data ?? ""} ${JSON.stringify(err?.data ?? "")} ${err?.message ?? ""}`;
      console.log(`[${opName}] retry (${attempt}): ${blob.slice(0,140)}`);
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// 1. Close
console.log("[close] closing round...");
let closeTx;
try {
  closeTx = await submit("close", [{ contractAddress: arena, entrypoint: "close", calldata: [] }]);
  await provider.waitForTransaction(closeTx.transaction_hash);
  console.log("[close] ok:", closeTx.transaction_hash);
} catch (err) {
  const blob = `${err?.data ?? ""} ${JSON.stringify(err?.data ?? "")}`;
  if (/ALREADY_CLOSED/i.test(blob)) {
    console.log("[close] already closed — continuing");
    closeTx = { transaction_hash: "already-closed" };
  } else throw err;
}

// 2. Read winner
const RPC_RAW = `https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
async function callView(name, cd = []) {
  const body = { jsonrpc: "2.0", id: 1, method: "starknet_call",
    params: [{ contract_address: arena, entry_point_selector: selectorOf(name), calldata: cd.map((v) => "0x" + BigInt(v).toString(16)) }, "latest"] };
  const res = await fetch(RPC_RAW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) throw new Error("view " + name + ": " + JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

const winner = (await callView("get_winner"))[0];
console.log("[winner]", winner);
const settlement = await callView("get_settlement");
console.log("[settlement]", JSON.stringify(settlement));

// 3. Settle prize (cap 100 units) — sponsor calls settle
const argAmount = process.argv.indexOf("--settle-amount");
const amount = argAmount > 0 ? BigInt(process.argv[argAmount + 1]) : 100n;
console.log(`[settle] settling ${amount} units to winner registrant...`);
const settleTx = await submit("settle", [
  { contractAddress: arena, entrypoint: "settle", calldata: [amount] },
]);
await provider.waitForTransaction(settleTx.transaction_hash);
console.log("[settle] ok:", settleTx.transaction_hash);

// 4. Evidence
const fs = await import("node:fs");
const summary = {
  network: "sepolia",
  closedAt: new Date().toISOString(),
  arena,
  winner_commitment: winner,
  settlement: settlement,
  transactions: { close: closeTx.transaction_hash, settle: settleTx.transaction_hash },
};
fs.writeFileSync(join(ROOT, ".local", "sepolia-settlement.json"), JSON.stringify(summary, null, 2));
console.log("\n=== SETTLEMENT SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
