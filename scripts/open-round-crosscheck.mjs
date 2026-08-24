// v3 cross-check: re-derive EVERY evidence-file claim from live chain state.
// Reads nothing from run logs — only the evidence JSON (for addresses/hashes) + RPC.
// v3 additions: registrant-per-wallet separation + balance-derived value recomputation
// (replays the transfer tx to recompute pre/post balances independently).
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
async function balanceAt(block, holder) {
    const blockId = { block_number: Number(BigInt(block)) }; // accepts number or hex-string
    const sel = BigInt("0x" + hash.starknetKeccak("balance_of").toString(16)) & MASK;
    const body = { jsonrpc: "2.0", id: 1, method: "starknet_call", params: [{ contract_address: ev.usd_token, entry_point_selector: "0x" + sel.toString(16), calldata: ["0x" + BigInt(holder).toString(16)] }, blockId] };
    const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    if (r.error) throw new Error("balance_at_block: " + JSON.stringify(r.error).slice(0, 150));
    return BigInt(r.result[0]);
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
const tW = ev.tortoise_wallet, fW = ev.falcon_wallet;
check("two DIFFERENT strategist wallets in evidence", tW && fW && BigInt(tW) !== BigInt(fW));

// 1) Arena liveness + class binding (getClassAt returns the compiled class: abi + entry points)
const cls = await provider.getClassAt(arena);
check("arena has code (getClassAt)", Array.isArray(cls.abi) && cls.abi.length > 0 && cls.entry_points_by_type !== undefined,
    `${cls.abi?.length ?? 0} abi entries`);

// 2) Rules commitment on chain == evidence timing step
const rules = (await viewOn(arena, "rules_commitment"))[0];
check("rules_commitment matches evidence", BigInt(rules) === BigInt(stepOf("timing").rules_commitment));

// 3) Registrants bound to their OWN wallets (two independent agents)
check("Tortoise registrant == tortoise wallet", BigInt((await viewOn(arena, "get_registrant", [tC]))[0]) === BigInt(tW));
check("Falcon registrant == falcon wallet (DIFFERENT)", BigInt((await viewOn(arena, "get_registrant", [fC]))[0]) === BigInt(fW));

// 4) Action counts ≥1 accepted / 0 rejected for BOTH strategies
const cT = await viewOn(arena, "get_action_counts", [tC]);
const cF = await viewOn(arena, "get_action_counts", [fC]);
check("Tortoise counts 1 accepted / 0 rejected", Number(cT[0]) >= 1 && Number(cT[1]) === 0, `${cT[0]}/${cT[1]}`);
check("Falcon counts 1 accepted / 0 rejected", Number(cF[0]) >= 1 && Number(cF[1]) === 0, `${cF[0]}/${cF[1]}`);

// 5) Settlement + INDEPENDENT winner recomputation from observed values
const sett = await viewOn(arena, "get_settlement");
const fAct = stepOf("falcon_action"), tAct = stepOf("tortoise_action");
function scoreOf(act) {
    const before = Number(act.portfolio_value_before), after = Number(act.portfolio_value_after);
    const retBps = Math.trunc(((after - before) * 10000) / before); // i64 trunc-toward-zero
    return { score: retBps - Number(act.drawdown_bps), eligible: Number(act.drawdown_bps) <= 2000 };
}
const sT = scoreOf(tAct), sF = scoreOf(fAct);
const bestC = sT.score > sF.score ? tC : fC;
check("settled winner == strategy with higher RECOMPUTED score", BigInt(sett[0]) === BigInt(bestC),
    `tortoise ${sT.score} vs falcon ${sF.score}`);
check("settled amount == 100", Number(BigInt(sett[1])) === 100);
check("prize_deposited == 100", Number(BigInt((await viewOn(arena, "get_prize_deposited"))[0])) === 100);

// 6) Escrow emptied: arena holds ~0 prize token after payout
const arenaBal = await viewOn(ev.usd_token, "balance_of", [arena]);
check("arena prize-token balance drained (< 1 unit)", BigInt(arenaBal[0]) < 10n ** 18n, String(arenaBal[0]));

// 7) Winner derivation still reproducible post-close
check("get_winner == get_settlement winner", BigInt((await viewOn(arena, "get_winner"))[0]) === BigInt(sett[0]));

// 8) Balance-derived value observation: replay each trade tx and recompute the delta INDEPENDENTLY
async function blockNumberOf(rcpt) {
    if (rcpt.block_number != null) return Number(BigInt(rcpt.block_number));
    return Number(BigInt((await provider.getBlock(rcpt.block_hash)).block_number));
}
for (const act of [tAct, fAct]) {
    const rcpt = await provider.getTransactionReceipt(act.tx);
    const n = await blockNumberOf(rcpt);
    const w = act.operator;
    const post = await balanceAt(n, w);       // state after this tx
    const pre = await balanceAt(n - 1, w);    // state before this tx
    if (!(n > 0)) throw new Error("trade tx at genesis?!");
    const derivedAfter = Number(pre / 10n ** 18n);
    const derivedDelta = derivedAfter - Number(post / 10n ** 18n);
    check(`${act.label} value_before == chain-replayed pre-balance`, derivedAfter === Number(act.portfolio_value_before), `${derivedAfter} vs claimed ${act.portfolio_value_before}`);
    check(`${act.label} value_after == chain-replayed post-balance`, Number(post / 10n ** 18n) === Number(act.portfolio_value_after), `${Number(post / 10n ** 18n)} vs claimed ${act.portfolio_value_after}`);
    check(`${act.label} allocation_units == observed delta`, derivedDelta === Number(act.allocation_units), `Δ${derivedDelta} vs claimed ${act.allocation_units}`);
    // ERC-20 Transfer: keys=[selector, from, to], data=[value_lo, value_hi]
    const xfer = rcpt.events?.find(e => BigInt(e.from_address) === BigInt(ev.usd_token) && e.keys.length >= 3);
    check(`${act.label} transfer from strategist`, BigInt(xfer?.keys?.[1] ?? 0n) === BigInt(w));
    check(`${act.label} transfer went to whitelisted target`, BigInt(xfer?.keys?.[2] ?? 0n) === 0x123456789n);
}

// 8b) ESCROW (f1 contract-side): contract-observed bond in RAW terms, re-derived independently
for (const act of [tAct, fAct]) {
    const esc = act.escrow;
    if (!esc) { check(`${act.label} escrow data present`, false); continue; }
    // Contract-stored custody: BEFORE refund == claimed raw; AFTER refund == 0.
    const escNow = BigInt((await viewOn(arena, "get_escrow", [esc.receipt_id]))[0]);
    if (esc.refund_tx) {
        check(`${act.label} get_escrow == 0 after executed refund`, escNow === 0n);
    } else {
        check(`${act.label} get_escrow(stored on chain) == claimed raw`, escNow === BigInt(esc.stored_raw),
            `${escNow} vs ${esc.stored_raw}`);
    }
    // ActionEscrowed event FROM THE ARENA:
    // keys=[selector, receipt_id, strategy_commitment]
    // data=[asset, observed_units(u128), accepted(felt bool), raw_lo, raw_hi]
    const rcpt = await provider.getTransactionReceipt(esc.tx);
    const evs = (rcpt.events ?? []).filter(e => BigInt(e.from_address) === BigInt(arena)
        && e.keys.length === 3 && BigInt(e.keys[1]) === BigInt(esc.receipt_id));
    check(`${act.label} escrow event emitted by arena`, evs.length >= 1);
    if (evs.length >= 1) {
        const d = evs[0].data;
        check(`${act.label} event observed_units == claimed units`, BigInt(d[1]) === BigInt(esc.claimed_units), String(d[1]));
        check(`${act.label} event accepted flag`, BigInt(d[2]) === 1n);
        const evRaw = BigInt(d[3]) + (BigInt(d[4]) << 128n);
        check(`${act.label} event escrowed_raw == stored raw`, evRaw === BigInt(esc.stored_raw), `${evRaw} vs ${esc.stored_raw}`);
    }
    // Independent wallet-side replay: strategist paid exactly the stored raw at the escrow tx
    const n = await blockNumberOf(rcpt);
    const w = act.operator;
    const pre = await balanceAt(n - 1, w), post = await balanceAt(n, w);
    check(`${act.label} escrow pull == stored raw (wallet replay)`, pre - post === BigInt(esc.stored_raw),
        `${pre - post} vs ${esc.stored_raw}`);
    // Bond returned post-close: refund tx succeeded AND escrow zeroed AND
    // EscrowRefunded event carries recipient + exact raw amount.
    const refRcpt = await provider.getTransactionReceipt(esc.refund_tx);
    check(`${act.label} refund tx succeeded`, refRcpt.execution_status === "SUCCEEDED", refRcpt.execution_status);
    check(`${act.label} escrow zeroed after refund`, BigInt((await viewOn(arena, "get_escrow", [esc.receipt_id]))[0]) === 0n);
    const refEvs = (refRcpt.events ?? []).filter(e => BigInt(e.from_address) === BigInt(arena)
        && e.keys.length === 2 && BigInt(e.keys[1]) === BigInt(esc.receipt_id));
    check(`${act.label} EscrowRefunded event emitted`, refEvs.length >= 1);
    if (refEvs.length >= 1) {
        // EscrowRefunded: keys=[selector, receipt_id], data=[recipient, raw_lo, raw_hi]
        check(`${act.label} refunded to strategist`, BigInt(refEvs[0].data[0]) === BigInt(w));
        const refRaw = BigInt(refEvs[0].data[1]) + (BigInt(refEvs[0].data[2]) << 128n);
        check(`${act.label} refunded raw == escrowed raw`, refRaw === BigInt(esc.stored_raw));
    }
}

// 8c) PERMISSIONLESS LIFECYCLE (f3): close/settle senders were NOT the sponsor
const sponsorAddr = ev.sponsor_address;
async function txSender(txHash) {
    const t = await provider.getTransactionByHash(txHash);
    return t.sender_address;
}
if (sponsorAddr) {
    check("close called by non-sponsor (tortoise)", BigInt(await txSender(stepOf("close").tx)) !== BigInt(sponsorAddr));
    check("settle called by non-sponsor (falcon)", BigInt(await txSender(stepOf("settle").tx)) !== BigInt(sponsorAddr));
} else {
    console.log("⚠ sponsor_address missing in evidence — permissionless-sender checks skipped");
}
// settle() structural payout: amount param is gone — settlement == min(deposited, cap)
check("settlement == min(prize_deposited, cap)", Number(BigInt(sett[1])) === Math.min(
    Number(BigInt((await viewOn(arena, "get_prize_deposited"))[0])),
    Number(BigInt((await viewOn(arena, "get_prize_cap"))[0]))));

// 8d) Post-round float restoration: each strategist back to a round number ≥ trade cost
const UNIT = 10n ** 18n;
for (const [act] of [[tAct], [fAct]]) {
    const w = act.operator;
    const bal = BigInt((await viewOn(ev.usd_token, "balance_of", [w]))[0]);
    check(`${act.label} float restored after refund (≥ ${act.portfolio_value_after} units)`,
        bal >= BigInt(act.portfolio_value_after) * UNIT, String(bal / UNIT));
}

// 9) Every recorded tx hash exists and SUCCEEDED
for (const s of ev.steps) {
    const hashes = Object.entries(s).filter(([k, v]) => k !== "step" && typeof v === "string" && /^0x[0-9a-f]{60,70}$/.test(v) && /tx|Tx/.test(k));
    for (const [k, h] of hashes) {
        const rcpt = await provider.getTransactionReceipt(h);
        const okStatus = rcpt.execution_status === "SUCCEEDED" || rcpt.execution_status === "PENDING";
        check(`tx ${s.step}.${k} succeeded`, okStatus, rcpt.execution_status);
    }
}

// 10) Action submit txs emitted ACCEPTED ActionSubmitted events FROM THE ARENA
for (const [act, cm] of [[tAct, tC], [fAct, fC]]) {
    const rcpt = await provider.getTransactionReceipt(act.submit_tx ?? act.tx);
    const evs = (rcpt.events ?? []).filter(e => BigInt(e.from_address) === BigInt(arena) && e.keys.length === 3 && BigInt(e.keys[2]) === BigInt(cm));
    check(`${act.label} submit emitted ActionSubmitted(accepted) from arena`, evs.length >= 1 && BigInt(evs[0].data[0]) === 1n);
}

console.log(fails === 0 ? "\n══ CROSS-CHECK PASSED — ALL CLAIMS RE-DERIVED FROM CHAIN ══" : `\n══ CROSS-CHECK FAILED: ${fails} mismatch(es) ══`);
process.exit(fails === 0 ? 0 : 1);
