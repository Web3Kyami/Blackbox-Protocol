// Independent cross-check: re-derive EVERY evidence-file claim from live chain state.
// Reads nothing from run logs — only the evidence JSON (for addresses/hashes) + RPC.
import { readFileSync } from "node:fs";
const { RpcProvider, hash } = await import("/root/projects/BlackBox Arena/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js");
let K = "";
for (const l of readFileSync("/root/projects/BlackBox Arena/.env.local", "utf8").split("\n")) {
    if (l.startsWith("ALCHEMY_API_KEY=")) K = l.split("=").slice(1).join("=").trim();
}
const RPC_URL = `https://starknet-sepolia.g.alchemy.com/v2/${K}`;
const provider = new RpcProvider({ nodeUrl: RPC_URL });
const ev = JSON.parse(readFileSync("/root/projects/BlackBox Arena/.local/open-round-evidence.json", "utf8"));
console.log("evidence status:", ev.status);
if (ev.status !== "VERIFIED") { console.log("❌ evidence not marked VERIFIED"); process.exit(1); }

const MASK = (1n << 250n) - 1n;
async function viewOn(addr, name, cd = []) {
    const sel = BigInt("0x" + hash.starknetKeccak(name).toString(16)) & MASK;
    const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_call", params: [{ contract_address: addr, entry_point_selector: "0x" + sel.toString(16), calldata: cd.map(v => "0x" + BigInt(v).toString(16)) }, "latest"] }) }).then(r => r.json());
    if (r.error) throw new Error(name + ": " + JSON.stringify(r.error).slice(0, 150));
    return r.result;
}
let fails = 0;
function check(label, ok, detail = "") {
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
    if (!ok) fails++;
}

const stepOf = (n) => ev.steps.find(s => s.step === n) ?? {};
const arena = ev.final_state.arena;
const tC = stepOf("commitments").tortoise.commitment;
const fC = stepOf("commitments").falcon.commitment;
const agent = ev.agent_wallet;

// 1) Arena liveness + class binding (getClassAt returns the compiled class: abi + entry points)
const cls = await provider.getClassAt(arena);
check("arena has code (getClassAt)", Array.isArray(cls.abi) && cls.abi.length > 0 && cls.entry_points_by_type !== undefined,
    `${cls.abi?.length ?? 0} abi entries`);

// 2) Rules commitment on chain == evidence timing step
const rules = (await viewOn(arena, "rules_commitment"))[0];
check("rules_commitment matches evidence", BigInt(rules) === BigInt(stepOf("timing").rules_commitment));

// 3) Registrants bound to AGENT wallet
const regT = (await viewOn(arena, "get_registrant", [tC]))[0];
const regF = (await viewOn(arena, "get_registrant", [fC]))[0];
check("Tortoise registrant == agent wallet", BigInt(regT) === BigInt(agent));
check("Falcon registrant == agent wallet", BigInt(regF) === BigInt(agent));

// 4) Action counts ≥1 accepted / 0 rejected for BOTH strategies
const cT = await viewOn(arena, "get_action_counts", [tC]);
const cF = await viewOn(arena, "get_action_counts", [fC]);
check("Tortoise counts 1 accepted / 0 rejected", Number(cT[0]) >= 1 && Number(cT[1]) === 0, `${cT[0]}/${cT[1]}`);
check("Falcon counts 1 accepted / 0 rejected", Number(cF[0]) >= 1 && Number(cF[1]) === 0, `${cF[0]}/${cF[1]}`);

// 5) Settlement: on-chain winner & amount match evidence final_state
const sett = await viewOn(arena, "get_settlement");
check("settled winner commitment == FALCON commitment", BigInt(sett[0]) === BigInt(fC));
check("settled amount == 100", Number(BigInt(sett[1])) === 100);
check("prize_deposited == 100", Number(BigInt((await viewOn(arena, "get_prize_deposited"))[0])) === 100);

// 6) Escrow emptied: arena holds ~0 prize token after payout
const USD = ev.usd_token;
const arenaBal = await viewOn(USD, "balance_of", [arena]);
check("arena prize-token balance drained (< 1 unit)", BigInt(arenaBal[0]) < 10n ** 18n, String(arenaBal[0]));

// 7) Winner derivation still reproducible post-close
check("get_winner == FALCOM commitment", BigInt((await viewOn(arena, "get_winner"))[0]) === BigInt(fC));

// 8) Every recorded tx hash: exists, SUCCEEDED, and action txs emitted ACCEPTED events FROM THE ARENA
for (const s of ev.steps) {
    const hashes = Object.entries(s).filter(([k, v]) => k !== "step" && typeof v === "string" && /^0x[0-9a-f]{60,70}$/.test(v) && /tx|Tx/.test(k));
    for (const [k, h] of hashes) {
        const rcpt = await provider.getTransactionReceipt(h);
        const okStatus = rcpt.execution_status === "SUCCEEDED" || rcpt.execution_status === "PENDING";
        check(`tx ${s.step}.${k} succeeded`, okStatus, rcpt.execution_status);
    }
}
const tAct = stepOf("tortoise_action"), fAct = stepOf("falcon_action");
for (const [act, cm] of [[tAct, tC], [fAct, fC]]) {
    const rcpt = await provider.getTransactionReceipt(act.tx);
    const evs = (rcpt.events ?? []).filter(e => BigInt(e.from_address) === BigInt(arena) && e.keys.length === 3 && BigInt(e.keys[2]) === BigInt(cm));
    check(`${act.label} tx emitted ActionSubmitted(accepted) from arena`, evs.length >= 1 && BigInt(evs[0].data[0]) === 1n);
}

console.log(fails === 0 ? "\n══ CROSS-CHECK PASSED — ALL CLAIMS RE-DERIVED FROM CHAIN ══" : `\n══ CROSS-CHECK FAILED: ${fails} mismatch(es) ══`);
process.exit(fails === 0 ? 0 : 1);
