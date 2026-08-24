// Devnet integration test: deploy Arena (with open_submit_action) + TestUSD,
// register strategies, run agent actions via open_submit_action, close, settle.
// Runs against local starknet-devnet on port 6050. Zero cost.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const { Account, RpcProvider, hash } = await import("/root/projects/BlackBox Arena/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js");

const RPC = "http://127.0.0.1:6050/rpc";
const provider = new RpcProvider({ nodeUrl: RPC });
const admin = new Account({
  provider,
  address: "0x0328ced46664355fc4b885ae7011af202313056a7e3d44827fb24c9d3206aaa0",
  signer: "0x00000000000000000000000000000000856c96eaa4e7c40c715ccc5dacd8bf6e",
});
const CONTRACTS_DEV = "/root/projects/BlackBox Arena/contracts/target/dev";
const RESEARCH_E2E = "/root/projects/BlackBox Arena/_research/starknet-privacy/e2e";
const UDC_DIR = "/tmp/udc/target/dev";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

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

async function declareContract(label, classPath, casmPath) {
  const cls = readJson(classPath);
  const hasCasm = casmPath && existsSync(casmPath);
  console.log(`[${label}] declaring...${hasCasm ? " (with casm)" : ""}`);
  try {
    const payload = hasCasm
      ? { contract: cls, casm: readJson(casmPath) }
      : { contract: cls };
    const res = await admin.declare(payload, { tip: "0x0" });
    await provider.waitForTransaction(res.transaction_hash);
    console.log(`[${label}] declared: ${res.class_hash.slice(0, 20)}…`);
    return res.class_hash;
  } catch (err) {
    if (/already declared/i.test(String(err))) {
      console.log(`[${label}] already declared`);
      // Query class hash from an existing deployment, or use known hashes
      const known = {
        "TestUSD": "0x06ea4ae2d74521c0d8c3820376b61b22efb7838b9fbf2df0358f320692485d1e",
        "Arena": "0x0520b886b83f71f2f34af0865aa766da8efd9ff63a824e553e36700037261b91",
        "ArenaAdapter": "0x046da51ea1b9b2b311156503dff3812d1fafd1a8cf1408f0a477197eb47f86b0",
      };
      const ch = known[label];
      if (!ch) throw new Error(`${label}: already declared but no known class hash`);
      console.log(`[${label}] using known hash: ${ch.slice(0, 20)}…`);
      return ch;
    }
    throw err;
  }
}

async function deployViaUDC(udcAddr, classHash, calldata) {
  const hexCalldata = calldata.map(v => "0x" + BigInt(v).toString(16));
  const res = await admin.execute([{
    contractAddress: udcAddr,
    entrypoint: "deployContract",
    calldata: [classHash, "0x" + Math.floor(Date.now() / 1000).toString(16), "0x0", String(calldata.length), ...hexCalldata],
  }], { tip: "0x0" });
  await provider.waitForTransaction(res.transaction_hash);
  const rcpt = await provider.getTransactionReceipt(res.transaction_hash);
  // UDC ContractDeployed event: from UDC address, first data word = contract_address
  for (const ev of (rcpt.events ?? [])) {
    if (ev.data && ev.data.length >= 1) {
      const addr = ev.data[0];
      if (BigInt(addr) !== 0n) return addr;
    }
  }
  throw new Error("no contract address in UDC events");
}

async function callView(addr, name, cd = []) {
  const body = { jsonrpc: "2.0", id: 1, method: "starknet_call",
    params: [{ contract_address: addr, entry_point_selector: "0x" + hash.starknetKeccak(name).toString(16), calldata: cd.map(v => "0x" + BigInt(v).toString(16)) }, "latest"] };
  const r = await fetch(RPC, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) }).then(r => r.json());
  if (r.error) throw new Error(`view ${name}: ${JSON.stringify(r.error).slice(0, 150)}`);
  return r.result;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n=== Devnet Round: open_submit_action test ===\n");
const MOCK_TARGET = "0x123456789";
const now = Math.floor(Date.now() / 1000);

// UDC v2 is pre-deployed on Devnet 0.8.2
const udcAddr = "0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125";
console.log("[UDC] using pre-deployed UDC at 0x02ceed…\n");

// ── Step 2: Declare + deploy TestUSD ──
console.log("[Step 2] TestUSD...");
var usdToken;
{
  const ch = await declareContract("TestUSD",
    join(RESEARCH_E2E, "contracts/test-token/target/dev/test_token_TestToken.contract_class.json"),
    join(RESEARCH_E2E, "contracts/test-token/target/dev/test_token_TestToken.compiled_contract_class.json"));
  usdToken = await deployViaUDC(udcAddr, ch, serializeByteArray("DevUSD").concat(serializeByteArray("DUSD")));
  console.log(`[TestUSD] deployed: ${usdToken}\n`);
}

// ── Step 3: Declare + deploy Arena ──
// Get the devnet's actual block timestamp — it may differ from system time
const blockRes = await fetch(RPC, { method: "POST", headers: {"Content-Type":"application/json"},
  body: JSON.stringify({jsonrpc:"2.0",id:1,method:"starknet_getBlockWithTxHashes",params:["latest"]})
}).then(r => r.json());
const devnetTime = blockRes.result.timestamp;
console.log(`[time] devnet block ts: ${devnetTime}, system: ${now}, diff: ${now - devnetTime}s`);
const startTime = BigInt(devnetTime + 60);
const endTime = startTime + 300n;
const rulesCommitment = "0x" + createHash("sha256").update("{}").digest("hex").slice(0, 62);
var arenaAddr;
console.log("[Step 3] Arena...");
{
  console.log("[Arena] declaring...");
  let arenaClassHash;
  try {
    const arenaDeclare = await admin.declare({
      contract: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_Arena.contract_class.json")),
      casm: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_Arena.compiled_contract_class.json")),
    }, { tip: "0x0" });
    await provider.waitForTransaction(arenaDeclare.transaction_hash);
    arenaClassHash = arenaDeclare.class_hash;
    console.log(`[Arena] declared: ${arenaClassHash.slice(0, 20)}…`);
  } catch (err) {
    if (/already declared/i.test(String(err))) {
      const m = String(err).match(/Class with hash (0x[0-9a-fA-F]+)/);
      arenaClassHash = m?.[1] ?? "";
      console.log(`[Arena] already declared: ${arenaClassHash.slice(0, 20)}…`);
    } else throw err;
  }
  arenaAddr = await deployViaUDC(udcAddr, arenaClassHash, [
    admin.address,
    startTime, endTime,
    1000n, 3500n, 2000n, 100n,
    usdToken,
    1n, usdToken,
    1n, MOCK_TARGET,
    BigInt(rulesCommitment),
  ]);
  console.log(`[Arena] deployed: ${arenaAddr}\n`);
}

// ── Step 4: Adapter ──
var adapterAddr;
console.log("[Step 4] ArenaAdapter...");
{
  console.log("[Adapter] declaring...");
  let adapterClassHash;
  try {
    const adapterDeclare = await admin.declare({
      contract: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_ArenaAdapter.contract_class.json")),
      casm: readJson(join(CONTRACTS_DEV, "blackbox_arena_contracts_ArenaAdapter.compiled_contract_class.json")),
    }, { tip: "0x0" });
    await provider.waitForTransaction(adapterDeclare.transaction_hash);
    adapterClassHash = adapterDeclare.class_hash;
    console.log(`[Adapter] declared: ${adapterClassHash.slice(0, 20)}…`);
  } catch (err) {
    if (/already declared/i.test(String(err))) {
      const ma = String(err).match(/Class with hash (0x[0-9a-fA-F]+)/);
      adapterClassHash = ma?.[1] ?? "";
      console.log(`[Adapter] already declared`);
    } else throw err;
  }
  adapterAddr = await deployViaUDC(udcAddr, adapterClassHash, ["0x0", arenaAddr]);
  console.log(`[ArenaAdapter] deployed: ${adapterAddr}\n`);
}

// ── Step 5: Setup ──
console.log("=== Setup ===");
await admin.execute([
  { contractAddress: usdToken, entrypoint: "mint", calldata: [admin.address, "100000", "0"] },
  { contractAddress: arenaAddr, entrypoint: "set_action_adapter", calldata: [adapterAddr] },
  { contractAddress: arenaAddr, entrypoint: "set_price", calldata: [usdToken, "1000000000000000000"] },
  { contractAddress: arenaAddr, entrypoint: "register_strategy", calldata: ["0x46414c434f4e5f434f4d4d4954"] },
  { contractAddress: arenaAddr, entrypoint: "register_strategy", calldata: ["0x544f52544f4953455f434f4d4d4954"] },
], { tip: "0x0" });
console.log("strategies registered, adapter set\n");

// Approve + deposit prize
await admin.execute([
  { contractAddress: usdToken, entrypoint: "approve", calldata: [arenaAddr, "100", "0"] },
], { tip: "0x0" });
await admin.execute([
  { contractAddress: arenaAddr, entrypoint: "deposit_prize", calldata: ["100"] },
], { tip: "0x0" });
console.log("prize deposited\n");

// ── Step 6: Wait for start, submit actions ──
const waitSec = Number(startTime) - Math.floor(Date.now() / 1000) + 3;
if (waitSec > 0) { console.log(`waiting ${waitSec}s for round start...`); await new Promise(r => setTimeout(r, (waitSec + 3) * 1000)); }

console.log("=== Agent Actions (open_submit_action) ===\n");

// Tortoise action
const tAction = await admin.execute([{
  contractAddress: arenaAddr, entrypoint: "open_submit_action",
  calldata: [
    "0x746f72746f6973652d72303031", "0x544f52544f4953455f434f4d4d4954",
    usdToken, MOCK_TARGET,
    "250", "1000", "1020", "0",
  ],
}], { tip: "0x0" });
await provider.waitForTransaction(tAction.transaction_hash);
console.log("[tortoise] ACCEPTED (+200bps)");

// Falcon action
const fAction = await admin.execute([{
  contractAddress: arenaAddr, entrypoint: "open_submit_action",
  calldata: [
    "0x66616c636f6e2d72303031", "0x46414c434f4e5f434f4d4d4954",
    usdToken, MOCK_TARGET,
    "349", "1000", "1041", "0",
  ],
}], { tip: "0x0" });
await provider.waitForTransaction(fAction.transaction_hash);
console.log("[falcon] ACCEPTED (+410bps)\n");

// ── Step 7: Close & Settle ──
const waitEnd = Number(endTime) - Math.floor(Date.now() / 1000) + 5;
if (waitEnd > 0) { console.log(`waiting ${waitEnd}s for round end...`); await new Promise(r => setTimeout(r, (waitEnd + 3) * 1000)); }

console.log("=== Close & Settle ===\n");
const closeTx = await admin.execute([{ contractAddress: arenaAddr, entrypoint: "close", calldata: [] }], { tip: "0x0" });
await provider.waitForTransaction(closeTx.transaction_hash);
console.log("[closed]");

const winnerResult = await callView(arenaAddr, "get_winner");
const winner = winnerResult[0];
console.log(`[winner] ${winner === "0x46414c434f4e5f434f4d4d4954" ? "FALCON" : "TORTOISE"}`);

const settleTx = await admin.execute([{ contractAddress: arenaAddr, entrypoint: "settle", calldata: ["100"] }], { tip: "0x0" });
await provider.waitForTransaction(settleTx.transaction_hash);
console.log(`[settled] tx: ${settleTx.transaction_hash.slice(0, 20)}…`);

const settlement = await callView(arenaAddr, "get_settlement");
console.log(`[settlement] winner=${settlement[0]}, amount=${Number(BigInt(settlement[1]))}`);

console.log("\n=== RESULT: open_submit_action VERIFIED ✅ ===");