import { readFileSync } from "node:fs";
const ROOT="/root/projects/BlackBox Arena";
let ALCHEMY_KEY="";
for(const l of readFileSync(`${ROOT}/.env.local`,"utf8").split("\n")) if(l.startsWith("ALCHEMY_API_KEY=")) ALCHEMY_KEY=l.split("=").slice(1).join("=").trim();
const RPC_URL=`https://starknet-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const { hash } = await import(`${ROOT}/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js`);
const MASK=(1n<<250n)-1n;
async function view(addr,name,cd=[]) {
  const sel=BigInt("0x"+hash.starknetKeccak(name).toString(16))&MASK;
  const body={jsonrpc:"2.0",id:1,method:"starknet_call",params:[{contract_address:addr,entry_point_selector:"0x"+sel.toString(16),calldata:cd.map(v=>"0x"+BigInt(v).toString(16))},"latest"]};
  const r=await fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
  if(r.error) throw new Error(name+" "+JSON.stringify(r.error).slice(0,400));
  return r.result;
}
async function getClass(classHash){
  const r=await fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"starknet_getClass",params:["latest",classHash]})}).then(r=>r.json());
  return r;
}
const ev=JSON.parse(readFileSync(`${ROOT}/.local/open-round-evidence.b1.json`,"utf8"));
const ARENA=ev.final_state.arena;
const ADAPTER=ev.final_state.adapter;
const USD=ev.usd_token;
const tC=ev.steps.find(s=>s.step==="commitments").tortoise.commitment;
const fC=ev.steps.find(s=>s.step==="commitments").falcon.commitment;
let ok=true;
function chk(label, cond, got, exp){
  if(!cond){ console.log(`❌ ${label}: got ${got} expected ${exp}`); ok=false; } else console.log(`✅ ${label}: ${got}`);
}
console.log("=== B1 independent crosscheck (no trust in run logs) ===\n");
console.log("Arena",ARENA);
console.log("Adapter",ADAPTER);
console.log("USD",USD);
console.log("tC",tC);
console.log("fC",fC);

// class existence
let r=await getClass(ev.arena_class_hash);
chk("Arena class exists", !r.error, r.error? JSON.stringify(r.error).slice(0,80): "exists", "exists");
r=await getClass(ev.adapter_class_hash);
chk("Adapter class exists", !r.error, r.error? JSON.stringify(r.error).slice(0,80): "exists", "exists");

// verify float_token bound
let ft=await view(ARENA,"get_float_token");
chk("float_token == USD", BigInt(ft[0])===BigInt(USD), ft[0], USD);

// attest start 1000*1e18
const TARGET_RAW=1000n*10n**18n;
let tStart=BigInt((await view(ARENA,"get_attest_start",[tC]))[0]);
let fStart=BigInt((await view(ARENA,"get_attest_start",[fC]))[0]);
chk("t attest_start 1000e18", tStart===TARGET_RAW, tStart.toString(), TARGET_RAW.toString());
chk("f attest_start 1000e18", fStart===TARGET_RAW, fStart.toString(), TARGET_RAW.toString());

// checkpoint counts 1 each
let tCnt=Number((await view(ARENA,"get_checkpoint_count",[tC]))[0]);
let fCnt=Number((await view(ARENA,"get_checkpoint_count",[fC]))[0]);
chk("t checkpoint count 1", tCnt===1, tCnt, 1);
chk("f checkpoint count 1", fCnt===1, fCnt, 1);

// checkpoint balances via poseidon-derived storage — direct getter
let tCp=await view(ARENA,"get_checkpoint",[tC,"0"]);
let fCp=await view(ARENA,"get_checkpoint",[fC,"0"]);
let tCpBal=BigInt(tCp[0]);
let fCpBal=BigInt(fCp[0]);
chk("t checkpoint 0 balance 980e18", tCpBal===980n*10n**18n, tCpBal.toString(), (980n*10n**18n).toString());
chk("f checkpoint 0 balance 995e18", fCpBal===995n*10n**18n, fCpBal.toString(), (995n*10n**18n).toString());
console.log(`  t cp ts=${tCp[1]} f cp ts=${fCp[1]}`);

// attest peak/maxDD after checkpoint
let tPeak=BigInt((await view(ARENA,"get_attest_peak",[tC]))[0]);
let fPeak=BigInt((await view(ARENA,"get_attest_peak",[fC]))[0]);
let tDd=Number((await view(ARENA,"get_attest_max_dd",[tC]))[0]);
let fDd=Number((await view(ARENA,"get_attest_max_dd",[fC]))[0]);
chk("t peak 1000e18", tPeak===TARGET_RAW, tPeak.toString(), TARGET_RAW.toString());
chk("f peak 1000e18", fPeak===TARGET_RAW, fPeak.toString(), TARGET_RAW.toString());
chk("t maxDD 200", tDd===200, tDd, 200);
chk("f maxDD 50", fDd===50, fDd, 50);

// action counts: tortoise 2 (1 adapter + 1 spoof), falcon 1
let tCounts=await view(ARENA,"get_action_counts",[tC]);
let fCounts=await view(ARENA,"get_action_counts",[fC]);
chk("t accepted 2", Number(tCounts[0])===2, tCounts[0], 2);
chk("t rejected 0", Number(tCounts[1])===0, tCounts[1], 0);
chk("f accepted 1", Number(fCounts[0])===1, fCounts[0], 1);
chk("f rejected 0", Number(fCounts[1])===0, fCounts[1], 0);

// live balances after withdraw + prize (post-settle view)
let tBal=BigInt((await view(USD,"balance_of",[ev.tortoise_wallet]))[0]);
let fBal=BigInt((await view(USD,"balance_of",[ev.falcon_wallet]))[0]);
console.log(`  live tBal ${tBal} fBal ${fBal}`);
chk("t live balance 1000e18 (post-withdraw)", tBal===TARGET_RAW, tBal.toString(), TARGET_RAW.toString());
chk("f live balance 1000e18+100 wei (prize)", fBal===TARGET_RAW+100n, fBal.toString(), (TARGET_RAW+100n).toString());

// get_score live branch rederive (independent scoring): effective_peak = max(start,peak,current)
// For t: current = tBal, effective = max(1000e18,1000e18,1000e18)=1000e18 => curDD 0, maxDD = max(0,200)=200 => eligible true
// But score derived from return_bps etc — winner still Falcon due to lower DD. Crosscheck winner == settlement.
let tScore=await view(ARENA,"get_score",[tC]);
let fScore=await view(ARENA,"get_score",[fC]);
console.log(`  tScore raw: ${JSON.stringify(tScore)}`);
console.log(`  fScore raw: ${JSON.stringify(fScore)}`);
let tFinal=BigInt(tScore[1]); // final_value
let fFinal=BigInt(fScore[1]);
let tMaxDdScore=Number(tScore[3]);
let fMaxDdScore=Number(fScore[3]);
let tElig=tScore[4]==="0x1" || tScore[4]==="1" || BigInt(tScore[4])===1n;
let fElig=fScore[4]==="0x1" || fScore[4]==="1" || BigInt(fScore[4])===1n;
chk("t score eligible", tElig, tScore[4], "1");
chk("f score eligible", fElig, fScore[4], "1");
chk("t maxDD in score 200", tMaxDdScore===200, tMaxDdScore, 200);
chk("f maxDD in score 50", fMaxDdScore===50, fMaxDdScore, 50);
// spoof resistance: score final_value must NOT be 5000 or 5e21; must equal live raw (post-withdraw) not spoof
let spoofUnits=5000n, spoofRaw=spoofUnits*10n**18n;
chk("t score not spoof units", tFinal!==spoofUnits && tFinal!==spoofRaw, tFinal.toString(), `not ${spoofRaw}`);
chk("t score == live tBal (post-withdraw)", tFinal===tBal, tFinal.toString(), tBal.toString());
chk("f score == live fBal", fFinal===fBal, fFinal.toString(), fBal.toString());

// winner / settlement crosscheck
let winner= (await view(ARENA,"get_winner"))[0];
let settlement= await view(ARENA,"get_settlement");
chk("winner == Falcon commitment", winner.toLowerCase()===fC.toLowerCase(), winner, fC);
chk("settlement winner == Falcon", settlement[0].toLowerCase()===fC.toLowerCase(), settlement[0], fC);
chk("settlement amount 100", BigInt(settlement[1])===100n, settlement[1], "100");
chk("prize deposited 100", BigInt((await view(ARENA,"get_prize_deposited"))[0])===100n, (await view(ARENA,"get_prize_deposited"))[0], "100");

// adapter custody after withdraw must be 0
let tReceipt="0x"+Buffer.from("tortoise-h005").toString("hex");
let fReceipt="0x"+Buffer.from("falcon-h005").toString("hex");
let tCust=await view(ADAPTER,"get_custody",[ev.tortoise_wallet,tReceipt]);
let fCust=await view(ADAPTER,"get_custody",[ev.falcon_wallet,fReceipt]);
let tCustAmt=BigInt(tCust[1])+(BigInt(tCust[2])<<128n);
let fCustAmt=BigInt(fCust[1])+(BigInt(fCust[2])<<128n);
chk("t custody after withdraw 0", tCustAmt===0n, tCustAmt.toString(), "0");
chk("f custody after withdraw 0", fCustAmt===0n, fCustAmt.toString(), "0");

// adapter should still have correct asset for those receipts (asset check even when amt 0)
chk("t custody asset USD", BigInt(tCust[0])===BigInt(USD), tCust[0], USD);
chk("f custody asset USD", BigInt(tCust[0])===BigInt(USD), fCust[0], USD);

// rules commitment matches timing evidence
let onchainRules=(await view(ARENA,"rules_commitment"))[0];
chk("rules commitment matches evidence", onchainRules.toLowerCase()===ev.steps.find(s=>s.step==="timing").rules_commitment.toLowerCase(), onchainRules, ev.steps.find(s=>s.step==="timing").rules_commitment);

// prize token matches USD
let prizeToken=(await view(ARENA,"get_prize_token"))[0];
chk("prize token == USD", BigInt(prizeToken)===BigInt(USD), prizeToken, USD);

console.log("\n"+(ok ? "=== ALL B1 CROSSCHECKS PASSED ===" : "=== SOME CHECKS FAILED ==="));
process.exit(ok?0:1);
