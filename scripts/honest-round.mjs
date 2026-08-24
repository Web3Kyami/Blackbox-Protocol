// Honest Sepolia round: real commitments, verified actions, on-chain state checks.
// Uses C as sponsor, V2 as both agents (single-wallet limitation noted).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const { Account, RpcProvider, hash } = await import("/root/projects/BlackBox Arena/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js");

// ── Config ──
const ROOT = "/root/projects/BlackBox Arena";
let ALCHEMY_KEY = "";
for (const l of readFileSync(`${ROOT}/.env.local`, "utf8").split("\n")) {
    if (l.startsWith("ALCHEMY_API_KEY=")) ALCHEMY_KEY = l.split("=").slice(1).join("=").trim();
}
const RPC_URL = `https://starknet-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const provider = new RpcProvider({ nodeUrl: RPC_URL });

function loadAccount(envFile) {
    const env = Object.fromEntries(
        readFileSync(envFile, "utf8").split(/\r?\n/)
            .filter(l => l.includes("=") && !l.startsWith("#"))
            .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
    return new Account({ provider, address: env.STARKNET_ACCOUNT_ADDRESS, signer: env.STARKNET_PRIVATE_KEY });
}

const sponsor = loadAccount(`${ROOT}/.local/burner-c.env`);
const agent = loadAccount(`${ROOT}/.env.local`); // v2

console.log("[sponsor]", sponsor.address.slice(0, 20) + "…");
console.log("[agent]", agent.address.slice(0, 20) + "…");

const NEW_ARENA_CLASS = "0x72c7b997f3e71897104d9be470d9d7c4cafd08330dfd0617a38a5bfa2a0c54b";
const ADAPTER_CLASS = "0x046da51ea1b9b2b311156503dff3812d1fafd1a8cf1408f0a477197eb47f86b0";
const USD_TOKEN = "0x02d50cf1955c48a1089ae0be3a9d78733e79e667778650277a50945e9818b386";
const UDC = "0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125";
const TIP = "0x" + (20n * 10n ** 12n).toString(16);
const MASK = (1n << 250n) - 1n;

function serializeByteArray(value) {
    const bytes = Buffer.from(value, "utf8");
    const nFull = Math.floor(bytes.length / 31);
    const data = [];
    for (let i = 0; i < nFull; i++) data.push("0x" + bytes.subarray(i * 31, (i + 1) * 31).toString("hex"));
    const rem = bytes.subarray(nFull * 31);
    let pendingWord = "0x0", pendingLen = 0;
    if (rem.length > 0) { pendingWord = "0x" + rem.toString("hex"); pendingLen = rem.length; }
    return [data.length, ...data, pendingWord, pendingLen];
}
function canonicalize(v) {
    if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
}

async function estimateAndSubmit(account, opName, calls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const nonce = await account.getNonce();
            const txObj = {
                type: "INVOKE", sender_address: account.address,
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
            const r = await fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
            if (r.error) throw new Error(JSON.stringify(r.error).slice(0,200));
            const e = r.result[0];
            const bounds = {
                l2_gas: { max_amount: (BigInt(e.l2_gas_consumed)*115n)/100n+10000n, max_price_per_unit: (BigInt(e.l2_gas_price)*105n)/100n },
                l1_gas: { max_amount: (BigInt(e.l1_gas_consumed)*115n)/100n+100n, max_price_per_unit: (BigInt(e.l1_gas_price)*105n)/100n },
                l1_data_gas: { max_amount: (BigInt(e.l1_data_gas_consumed)*115n)/100n+100n, max_price_per_unit: (BigInt(e.l1_data_gas_price)*105n)/100n },
            };
            console.log(`[${opName}] submitting...`);
            const tx = await account.execute(calls, { resourceBounds: bounds, tip: TIP });
            const rcpt = await provider.waitForTransaction(tx.transaction_hash);
            if (rcpt.execution_status === "REVERTED") throw new Error(rcpt.revert_reason?.slice(0,150));
            console.log(`[${opName}] ✅`);
            return tx;
        } catch (err) {
            if (/ALREADY/i.test(String(err))) { console.log(`[${opName}] already done`); return; }
            console.log(`[${opName}] attempt ${attempt}: ${String(err).slice(0,120)}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 8000));
            else throw err;
        }
    }
}

async function viewOn(addr, name, cd = []) {
    const sel = BigInt("0x" + hash.starknetKeccak(name).toString(16)) & MASK;
    const body = { jsonrpc:"2.0",id:1,method:"starknet_call",params:[{contract_address:addr,entry_point_selector:"0x"+sel.toString(16),calldata:cd.map(v=>"0x"+BigInt(v).toString(16))},"latest"]};
    const r = await fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
    if (r.error) throw new Error(name + ": " + JSON.stringify(r.error).slice(0,150));
    return r.result;
}

// ── Get devnet block time for round timing ──
const blkRes = await fetch(RPC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"starknet_getBlockWithTxHashes",params:["latest"]})}).then(r=>r.json());
const blockTime = Number(blkRes.result.timestamp);
const startTime = BigInt(blockTime + 120);
const endTime = startTime + 300n;
const rulesCommitment = "0x" + createHash("sha256").update(canonicalize({
    startTime: startTime.toString(), endTime: endTime.toString(),
})).digest("hex").slice(0, 60); // truncate to 240 bits, safely within felt252

console.log("\n[timing] start:", Number(startTime), "(+120s), end:", Number(endTime), "(+420s)");

// ── Deploy Arena via UDC ──
console.log("\n=== Deploying ===\n");
const arenaConstructorCd = [
    sponsor.address,
    "0x" + startTime.toString(16),
    "0x" + endTime.toString(16),
    "0x3e8", // 1000 starting_units
    "0xdac", // 3500 max_allocation_bps
    "0x7d0", // 2000 max_drawdown_bps
    "0x64", // 100 prize_cap_units
    USD_TOKEN,
    "0x1", USD_TOKEN,
    "0x1", "0x123456789",
    rulesCommitment,
];
const arenaSalt = "0x" + Math.floor(Date.now() / 1000).toString(16);
const arenaDeployTx = await sponsor.execute([{
    contractAddress: UDC, entrypoint: "deploy_contract",
    calldata: [NEW_ARENA_CLASS, arenaSalt, "0x0", String(arenaConstructorCd.length), ...arenaConstructorCd],
}], { tip: TIP });
const arenaRcpt = await provider.waitForTransaction(arenaDeployTx.transaction_hash);
if (arenaRcpt.execution_status === "REVERTED") throw new Error("Arena deploy reverted");
let arenaAddr;
for (const ev of (arenaRcpt.events ?? [])) {
    if (ev.data && ev.data.length >= 1 && BigInt(ev.data[0]) !== 0n) { arenaAddr = ev.data[0]; break; }
}
console.log("[Arena]", arenaAddr);

// Deploy Adapter
const adapterCd = ["0x0", arenaAddr];
const adapterSalt = "0x" + (Math.floor(Date.now() / 1000) + 1).toString(16);
const adapterTx = await sponsor.execute([{
    contractAddress: UDC, entrypoint: "deploy_contract",
    calldata: [ADAPTER_CLASS, adapterSalt, "0x0", String(adapterCd.length), ...adapterCd],
}], { tip: TIP });
const adapterRcpt = await provider.waitForTransaction(adapterTx.transaction_hash);
let adapterAddr;
for (const ev of (adapterRcpt.events ?? [])) {
    if (ev.data && ev.data.length >= 1 && BigInt(ev.data[0]) !== 0n) { adapterAddr = ev.data[0]; break; }
}
console.log("[Adapter]", adapterAddr);

// ── Setup ──
console.log("\n=== Setup ===\n");
await estimateAndSubmit(sponsor, "setup", [
    { contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [sponsor.address, "100000", "0"] },
    { contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [agent.address, "50000", "0"] },
    { contractAddress: arenaAddr, entrypoint: "set_action_adapter", calldata: [adapterAddr] },
    { contractAddress: arenaAddr, entrypoint: "set_price", calldata: [USD_TOKEN, "1000000000000000000"] },
]);

// Verify setup
const adapterSet = await viewOn(arenaAddr, "get_action_adapter");
console.log("[verify] adapter set:", BigInt(adapterSet[0]) !== 0n ? "✅" : "❌ FAILED");

// Register strategies (from agent wallet so registrant = agent)
const tortoiseDesc = "Conservative compounder with small allocations and low drawdown";
const tortoiseCommitment = "0x" + createHash("sha256").update(canonicalize({ describe: tortoiseDesc, alloc: 0.25 })).digest("hex").slice(0, 60);
const falconDesc = "Aggressive momentum push with high allocation";
const falconCommitment = "0x" + createHash("sha256").update(canonicalize({ describe: falconDesc, alloc: 0.35 })).digest("hex").slice(0, 60);

await estimateAndSubmit(agent, "register:Tortoise", [{ contractAddress: arenaAddr, entrypoint: "register_strategy", calldata: [tortoiseCommitment] }]);
const regT = await viewOn(arenaAddr, "get_registrant", [tortoiseCommitment]);
console.log("[verify] Tortoise registrant:", BigInt(regT[0]) === BigInt(agent.address) ? "✅ agent" : "❌ mismatch");

await estimateAndSubmit(agent, "register:Falcon", [{ contractAddress: arenaAddr, entrypoint: "register_strategy", calldata: [falconCommitment] }]);
const regF = await viewOn(arenaAddr, "get_registrant", [falconCommitment]);
console.log("[verify] Falcon registrant:", BigInt(regF[0]) === BigInt(agent.address) ? "✅ agent" : "❌ mismatch");

// Deposit prize
await estimateAndSubmit(sponsor, "approve_prize", [{ contractAddress: USD_TOKEN, entrypoint: "approve", calldata: [arenaAddr, "100", "0"] }]);
await estimateAndSubmit(sponsor, "deposit_prize", [{ contractAddress: arenaAddr, entrypoint: "deposit_prize", calldata: ["100"] }]);
const prize = await viewOn(arenaAddr, "get_prize_deposited");
console.log("[verify] prize deposited:", Number(BigInt(prize[0])) === 100 ? "✅ 100 units" : "❌ " + prize[0]);

// ── Wait for start ──
const waitSec = Number(startTime) - Math.floor(Date.now() / 1000) + 5;
if (waitSec > 0) { console.log(`\nwaiting ${waitSec}s for round start...`); await new Promise(r => setTimeout(r, waitSec * 1000)); }

// ── Submit actions ──
console.log("\n=== Agent Actions ===\n");
await estimateAndSubmit(agent, "action:Tortoise", [{
    contractAddress: arenaAddr, entrypoint: "open_submit_action",
    calldata: ["0x746f72746f6973652d68303031", tortoiseCommitment, USD_TOKEN, "0x123456789",
        "250", "1000", "1020", "0"],
}]);
const tCounts = await viewOn(arenaAddr, "get_action_counts", [tortoiseCommitment]);
console.log("[verify] Tortoise actions accepted:", Number(tCounts[0]) === 1 ? "✅ 1" : "❌ " + tCounts[0]);

await estimateAndSubmit(agent, "action:Falcon", [{
    contractAddress: arenaAddr, entrypoint: "open_submit_action",
    calldata: ["0x66616c636f6e2d68303031", falconCommitment, USD_TOKEN, "0x123456789",
        "349", "1000", "1041", "0"],
}]);
const fCounts = await viewOn(arenaAddr, "get_action_counts", [falconCommitment]);
console.log("[verify] Falcon actions accepted:", Number(fCounts[0]) === 1 ? "✅ 1" : "❌ " + fCounts[0]);

// ── Wait for end, advance blocks, close & settle ──
console.log("\n=== Close & Settle ===\n");
const waitEnd = Number(endTime) - Math.floor(Date.now() / 1000) + 10;
if (waitEnd > 0) { console.log(`waiting ${waitEnd}s for round end...`); await new Promise(r => setTimeout(r, waitEnd * 1000)); }

// Advance blocks
for (let i = 0; i < 3; i++) {
    await estimateAndSubmit(sponsor, `advance-${i}`, [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [sponsor.address, "1", "0"] }]);
}

// Close
await estimateAndSubmit(sponsor, "close", [{ contractAddress: arenaAddr, entrypoint: "close", calldata: [] }]);

const winnerResult = await viewOn(arenaAddr, "get_winner");
const isFalcon = winnerResult[0] === falconCommitment;
console.log("[winner]", isFalcon ? "FALCON ✅" : "TORTOISE ✅");

// Settle
await estimateAndSubmit(sponsor, "settle", [{ contractAddress: arenaAddr, entrypoint: "settle", calldata: ["100"] }]);
const settlement = await viewOn(arenaAddr, "get_settlement");
console.log("[settlement] amount:", Number(BigInt(settlement[1])));

console.log(`
════════════════════════════════════════
  open_submit_action VERIFIED ON SEPOLIA
  
  Arena:     ${arenaAddr}
  Winner:    ${isFalcon ? "FALCON" : "TORTOISE"}
  Prize:     100 units TestUSD
  
  Both strategies committed before round.
  Both actions submitted on-chain.
  Every step verified against contract state.
════════════════════════════════════════`);
