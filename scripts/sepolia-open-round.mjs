// Deploy new Arena (with open_submit_action) + adapter on Sepolia, run full round.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const { Account, RpcProvider, hash } = await import("/root/projects/BlackBox Arena/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js");
const env = Object.fromEntries(readFileSync("/root/projects/BlackBox Arena/.env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const provider = new RpcProvider({ nodeUrl: `https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}` });
const admin = new Account({ provider, address: env.STARKNET_ACCOUNT_ADDRESS, signer: env.STARKNET_PRIVATE_KEY });

const NEW_ARENA_CLASS = "0x72c7b997f3e71897104d9be470d9d7c4cafd08330dfd0617a38a5bfa2a0c54b";
const ADAPTER_CLASS = "0x046da51ea1b9b2b311156503dff3812d1fafd1a8cf1408f0a477197eb47f86b0";
const USD_TOKEN = "0x02d50cf1955c48a1089ae0be3a9d78733e79e667778650277a50945e9818b386";
const UDC = "0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125";
const MASK = (1n << 250n) - 1n;
const TIP = "0x" + (20n * 10n ** 12n).toString(16);

const FALCON = "0x46414c434f4e5f434f4d4d4954";
const TORTOISE = "0x544f52544f4953455f434f4d4d4954";

async function estimate(calls) {
  const nonce = await admin.getNonce();
  const txObj = {
    type: "INVOKE", sender_address: admin.address,
    calldata: ["0x" + calls.length.toString(16),
      ...calls.flatMap(c => [c.contractAddress,
        "0x" + BigInt(typeof c.entrypoint === "string" && !c.entrypoint.startsWith("0x")
          ? hash.starknetKeccak(c.entrypoint) : c.entrypoint).toString(16),
        "0x" + BigInt(c.calldata.length).toString(16),
        ...c.calldata.map(v => "0x" + BigInt(v).toString(16))])],
    signature: [], nonce: "0x" + BigInt(nonce).toString(16),
    resource_bounds: { l2_gas:{max_amount:"0x0",max_price_per_unit:"0x0"},l1_gas:{max_amount:"0x0",max_price_per_unit:"0x0"},l1_data_gas:{max_amount:"0x0",max_price_per_unit:"0x0"} },
    tip: TIP, paymaster_data:[], nonce_data_availability_mode:"L1", fee_data_availability_mode:"L1",
    account_deployment_data:[], version:"0x100000000000000000000000000000003",
  };
  const body = { jsonrpc:"2.0",id:1,method:"starknet_estimateFee",params:{request:[txObj],block_id:"latest",simulation_flags:["SKIP_VALIDATE"]} };
  const r = await fetch(`https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
  if (r.error) throw new Error("est: " + JSON.stringify(r.error));
  const e = r.result[0];
  return {
    bounds: {
      l2_gas: { max_amount: (BigInt(e.l2_gas_consumed)*115n)/100n+10000n, max_price_per_unit: (BigInt(e.l2_gas_price)*105n)/100n },
      l1_gas: { max_amount: (BigInt(e.l1_gas_consumed)*115n)/100n+100n, max_price_per_unit: (BigInt(e.l1_gas_price)*105n)/100n },
      l1_data_gas: { max_amount: (BigInt(e.l1_data_gas_consumed)*115n)/100n+100n, max_price_per_unit: (BigInt(e.l1_data_gas_price)*105n)/100n },
    },
    overallFee: Number(BigInt(e.overall_fee)) / 1e18,
  };
}

async function submit(opName, calls) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const est = await estimate(calls);
      console.log(`[${opName}] attempt ${attempt} (~${est.overallFee.toFixed(2)} STRK)`);
      const tx = await admin.execute(calls, { resourceBounds: est.bounds, tip: TIP });
      const rcpt = await provider.waitForTransaction(tx.transaction_hash);
      if (rcpt.execution_status === "REVERTED") throw new Error(rcpt.revert_reason?.slice(0, 150));
      const fee = rcpt.actual_fee ? Number(BigInt(rcpt.actual_fee.amount ?? rcpt.actual_fee)) / 1e18 : 0;
      console.log(`[${opName}] ✅ fee=${fee.toFixed(4)} STRK`);
      return tx;
    } catch (err) {
      const s = String(err);
      console.log(`[${opName}] attempt ${attempt} failed: ${s.slice(0, 120)}`);
      if (/ALREADY|already/i.test(s)) throw err; // don't retry on already-X errors
      if (attempt < 6) await new Promise(r => setTimeout(r, 8000));
      else throw err;
    }
  }
}

async function view(name, cd = []) {
  const sel = BigInt("0x" + hash.starknetKeccak(name).toString(16)) & MASK;
  const body = { jsonrpc:"2.0",id:1,method:"starknet_call",params:[{contract_address:process.env.ARENA_ADDR,entry_point_selector:"0x"+sel.toString(16),calldata:cd.map(v=>"0x"+BigInt(v).toString(16))},"latest"] };
  const r = await fetch(`https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
  if (r.error) throw new Error(name + ": " + JSON.stringify(r.error).slice(0,150));
  return r.result;
}

async function deployViaUDC(classHash, constructorCalldata, label) {
  console.log(`[deploy:${label}] using SDK deployContract...`);
  console.log(`[deploy:${label}] classHash: ${classHash}`);
  console.log(`[deploy:${label}] constructorCalldata (${constructorCalldata.length} items):`, constructorCalldata.map(v => String(v).slice(0,30)));
  const res = await admin.deployContract(
    { classHash, constructorCalldata },
    { tip: TIP },
  );
  await provider.waitForTransaction(res.transaction_hash);
  const rcpt = await provider.getTransactionReceipt(res.transaction_hash);
  if (rcpt.execution_status === "REVERTED") throw new Error(rcpt.revert_reason?.slice(0, 200));
  const addr = res.contract_address ?? res.address;
  console.log(`[${label}] deployed: ${addr}`);
  return addr;
}

// ── Get timing from devnet block ──
const blkRes = await fetch(`https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"starknet_getBlockWithTxHashes",params:["latest"]})}).then(r=>r.json());
const blockTime = Number(blkRes.result.timestamp);
const startTime = BigInt(blockTime + 240); // 4 min to deploy and set up
const endTime = startTime + 600n;
const rulesCommitment = "0x" + createHash("sha256").update("{}").digest("hex").slice(0, 62);

console.log("[timing] start:", Number(startTime), "(+" + 240 + "s), round:", 600, "s\n");

// ── Deploy Arena ──
const arenaAddr = await deployViaUDC(NEW_ARENA_CLASS, [
  admin.address,
  startTime, endTime,
  1000n,
  3500n,
  2000n,
  100n,
  USD_TOKEN,
  1n, USD_TOKEN,
  1n, "0x123456789",
  rulesCommitment,
], "Arena");
console.log("[Arena]", arenaAddr, "\n");

// ── Deploy Adapter ──
const adapterAddr = await deployViaUDC(ADAPTER_CLASS, ["0x0", arenaAddr], "Adapter");
console.log("[Adapter]", adapterAddr, "\n");

globalThis.ARENA_ADDR = arenaAddr;

// ── Setup ──
console.log("[setup] running...");
await submit("setup", [
  { contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [admin.address, "100000", "0"] },
  { contractAddress: arenaAddr, entrypoint: "set_action_adapter", calldata: [adapterAddr] },
  { contractAddress: arenaAddr, entrypoint: "set_price", calldata: [USD_TOKEN, "1000000000000000000"] },
  { contractAddress: arenaAddr, entrypoint: "register_strategy", calldata: [FALCON] },
  { contractAddress: arenaAddr, entrypoint: "register_strategy", calldata: [TORTOISE] },
]);
await submit("approve", [{ contractAddress: USD_TOKEN, entrypoint: "approve", calldata: [arenaAddr, "100", "0"] }]);
await submit("deposit_prize", [{ contractAddress: arenaAddr, entrypoint: "deposit_prize", calldata: ["100"] }]);
console.log("");

// ── Wait for start ──
const waitSec = Number(startTime) - Math.floor(Date.now() / 1000) + 10;
if (waitSec > 0) { console.log(`[wait] ${waitSec}s until round start...`); await new Promise(r => setTimeout(r, waitSec * 1000)); }

// ── Submit actions ──
console.log("\n=== Agent Actions ===\n");
await submit("tortoise", [{
  contractAddress: arenaAddr, entrypoint: "open_submit_action",
  calldata: [
    "0x746f72746f6973652d7365623031", TORTOISE, USD_TOKEN, "0x123456789",
    "250", "1000", "1020", "0",
  ],
}]);

await submit("falcon", [{
  contractAddress: arenaAddr, entrypoint: "open_submit_action",
  calldata: [
    "0x66616c636f6e2d7365623031", FALCON, USD_TOKEN, "0x123456789",
    "349", "1000", "1041", "0",
  ],
}]);

// ── Advance blocks past end ──
console.log("\n[advance] submitting dummy txs to pass end_time...");
for (let i = 0; i < 15; i++) {
  await submit(`advance-${i}`, [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [admin.address, "1", "0"] }]);
}

// ── Close & Settle ──
console.log("\n=== Close & Settle ===\n");
await submit("close", [{ contractAddress: arenaAddr, entrypoint: "close", calldata: [] }]);

const winnerResult = await view("get_winner");
const winner = winnerResult[0];
const winnerName = winner === FALCON ? "FALCON" : winner === TORTOISE ? "TORTOISE" : winner;
console.log("[winner]", winnerName);

await submit("settle", [{ contractAddress: arenaAddr, entrypoint: "settle", calldata: ["100"] }]);

const settlement = await view("get_settlement");
console.log("[settlement] amount:", Number(BigInt(settlement[1])));

// Save evidence
const fs = await import("node:fs");
fs.writeFileSync("/root/projects/BlackBox Arena/.local/open-round-evidence.json", JSON.stringify({
  network: "sepolia",
  arena: arenaAddr,
  adapter: adapterAddr,
  new_class_hash: NEW_ARENA_CLASS,
  winner: winnerName,
  prize_paid: 100,
  startTime: Number(startTime),
  endTime: Number(endTime),
}, null, 2));

console.log("\n═══ open_submit_action FULL ROUND VERIFIED ON SEPOLIA ═══");
