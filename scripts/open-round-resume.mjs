// Resume open_submit_action round: actions → advance → close → settle
import { readFileSync } from "node:fs";
const { Account, RpcProvider, hash } = await import("/root/projects/BlackBox Arena/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js");
const env = Object.fromEntries(readFileSync("/root/projects/BlackBox Arena/.env.local", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const provider = new RpcProvider({ nodeUrl: `https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}` });
const admin = new Account({ provider, address: env.STARKNET_ACCOUNT_ADDRESS, signer: env.STARKNET_PRIVATE_KEY });

const st = JSON.parse(readFileSync("/root/projects/BlackBox Arena/.local/open-round-state.json", "utf8"));
const arena = st.arena;
const usdToken = st.usd_token;
const FALCON = "0x46414c434f4e5f434f4d4d4954";
const TORTOISE = "0x544f52544f4953455f434f4d4d4954";
const TIP = "0x" + (20n * 10n ** 12n).toString(16);

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
    estFee: Number(BigInt(e.overall_fee)) / 1e18,
  };
}

let totalFees = 0;
async function submit(opName, calls) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const est = await estimate(calls);
      console.log(`[${opName}] ~${est.estFee.toFixed(3)} STRK`);
      const tx = await admin.execute(calls, { resourceBounds: est.bounds, tip: TIP });
      const rcpt = await provider.waitForTransaction(tx.transaction_hash);
      if (rcpt.execution_status === "REVERTED") throw new Error(rcpt.revert_reason?.slice(0, 120));
      const fee = rcpt.actual_fee ? Number(BigInt(rcpt.actual_fee.amount ?? rcpt.actual_fee)) / 1e18 : 0;
      totalFees += fee;
      console.log(`[${opName}] ✅ fee=${fee.toFixed(4)} STRK (total so far: ${totalFees.toFixed(2)})`);
      return;
    } catch (err) {
      const s = String(err);
      if (/ALREADY/i.test(s)) { console.log(`[${opName}] already done`); return; }
      console.log(`[${opName}] attempt ${attempt}: ${s.slice(0,120)}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 8000));
      else throw err;
    }
  }
}

async function view(name, cd = []) {
  const sel = BigInt("0x" + hash.starknetKeccak(name).toString(16)) & ((1n << 250n) - 1n);
  const body = { jsonrpc:"2.0",id:1,method:"starknet_call",params:[{contract_address:arena,entry_point_selector:"0x"+sel.toString(16),calldata:cd.map(v=>"0x"+BigInt(v).toString(16))},"latest"]};
  const r = await fetch(`https://starknet-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
  if (r.error) throw new Error(name + ": " + JSON.stringify(r.error).slice(0,150));
  return r.result;
}

// ── Submit agent actions ──
console.log("\n=== Agent Actions ===\n");
await submit("tortoise", [{
  contractAddress: arena, entrypoint: "open_submit_action",
  calldata: ["0x746f72746f6973652d6f703031", TORTOISE, usdToken, "0x123456789",
    "250", "1000", "1020", "0"],
}]);

await submit("falcon", [{
  contractAddress: arena, entrypoint: "open_submit_action",
  calldata: ["0x66616c636f6e2d6f703031", FALCON, usdToken, "0x123456789",
    "349", "1000", "1041", "0"],
}]);

// ── Advance blocks past end_time ──
const endTime = Math.floor(Date.now() / 1000) + 30; // we'll wait 30s then advance
console.log("\n[wait] 35s for round to end...");
await new Promise(r => setTimeout(r, 35000));

console.log("\n[advance] submitting dummy txs...");
for (let i = 0; i < 10; i++) {
  await submit(`adv-${i}`, [{ contractAddress: usdToken, entrypoint: "mint", calldata: [admin.address, "1", "0"] }]);
}

// ── Close & Settle ──
console.log("\n=== Close & Settle ===\n");
await submit("close", [{ contractAddress: arena, entrypoint: "close", calldata: [] }]);

const winnerResult = await view("get_winner");
const winner = winnerResult[0];
const name = winner === FALCON ? "FALCON" : winner === TORTOISE ? "TORTOISE" : winner;
console.log("[winner]", name);

await submit("settle", [{ contractAddress: arena, entrypoint: "settle", calldata: ["100"] }]);

const settlement = await view("get_settlement");
console.log("[settlement] amount:", Number(BigInt(settlement[1])));

console.log(`\n=== TOTAL FEES: ${totalFees.toFixed(2)} STRK ===`);
console.log(`Winner: ${name}, Prize: 100 units`);
