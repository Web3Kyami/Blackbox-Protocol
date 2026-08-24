// Honest Sepolia round v3 — TWO independent strategist wallets + contract-observed trade values (f1).
// Flow: deploy(Arena,Adapter) → setup → register(Tortoise=v2, Falcon=v1) → prize →
//       real transfers through whitelisted target → close → settle.
// Value deltas are DERIVED from balance_of reads around each transfer — never caller-invented.
// Every write is verified via view calls ON THE SAME arenaAddr (skill: onchain-verify-not-logs).
// Fail-closed: any verification mismatch aborts the run and marks the evidence FAILED.
import { readFileSync, copyFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
const ROOT = "/root/projects/BlackBox Arena";
const { Account, RpcProvider, hash } = await import(`${ROOT}/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js`);

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
const tortoiseWallet = loadAccount(`${ROOT}/.env.local`);            // v2 — Tortoise strategist/operator
const falconWallet = loadAccount(`${ROOT}/.local/burner-v1-backup.env`); // v1 — Falcon strategist/operator

console.log("[sponsor]", sponsor.address.slice(0, 20) + "…");
console.log("[tortoise]", tortoiseWallet.address.slice(0, 20) + "…");
console.log("[falcon] ", falconWallet.address.slice(0, 20) + "…");

const NEW_ARENA_CLASS = "0x72c7b997f3e71897104d9be470d9d7c4cafd08330dfd0617a38a5bfa2a0c54b";
const ADAPTER_CLASS = "0x046da51ea1b9b2b311156503dff3812d1fafd1a8cf1408f0a477197eb47f86b0";
const USD_TOKEN = "0x02d50cf1955c48a1089ae0be3a9d78733e79e667778650277a50945e9818b386";
const TRADE_TARGET = "0x123456789"; // whitelisted action target (also the float overflow sink)
// Modest tip: large tips multiply against l2_gas max_amount inside account-balance validation
// and can spuriously trip "resources exceed balance" (seen live: 2e13 tip × 6.3M gas > wallet).
const TIP = "0x" + (1n * 10n ** 12n).toString(16);
const MASK = (1n << 250n) - 1n;

// D016 fee path: raw starknet_estimateFee (named params), tight bounds — NOT SDK defaults,
// whose generous padding trips account-balance validation on the agent wallet.
async function tightBounds(account, calls) {
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
        resource_bounds: { l2_gas: { max_amount: "0x0", max_price_per_unit: "0x0" }, l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" }, l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" } },
        tip: TIP, paymaster_data: [], nonce_data_availability_mode: "L1", fee_data_availability_mode: "L1",
        account_deployment_data: [], version: "0x100000000000000000000000000000003",
    };
    const body = { jsonrpc: "2.0", id: 1, method: "starknet_estimateFee", params: { request: [txObj], block_id: "latest", simulation_flags: ["SKIP_VALIDATE"] } };
    const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    if (r.error) throw new Error("estimate: " + JSON.stringify(r.error).slice(0, 200));
    const e = r.result[0];
    return {
        l2_gas: { max_amount: (BigInt(e.l2_gas_consumed) * 115n) / 100n + 10000n, max_price_per_unit: (BigInt(e.l2_gas_price) * 105n) / 100n },
        l1_gas: { max_amount: (BigInt(e.l1_gas_consumed) * 115n) / 100n + 100n, max_price_per_unit: (BigInt(e.l1_gas_price) * 105n) / 100n },
        l1_data_gas: { max_amount: (BigInt(e.l1_data_gas_consumed) * 115n) / 100n + 100n, max_price_per_unit: (BigInt(e.l1_data_gas_price) * 105n) / 100n },
        estStrk: Number(BigInt(e.overall_fee)) / 1e18,
    };
}

async function sendTx(account, opName, calls) {
    const est = await tightBounds(account, calls);
    const { estStrk, ...bounds } = est;
    console.log(`[${opName}] submitting (~${estStrk.toFixed(4)} STRK est)...`);
    const tx = await account.execute(calls, { resourceBounds: bounds, tip: TIP });
    const rcpt = await provider.waitForTransaction(tx.transaction_hash);
    if (rcpt.execution_status === "REVERTED") throw new Error(`${opName} reverted: ` + String(rcpt.revert_reason ?? "unknown").slice(0, 150));
    const fee = rcpt.actual_fee ? Number(BigInt(rcpt.actual_fee.amount ?? rcpt.actual_fee)) / 1e18 : NaN;
    console.log(`[${opName}] ✅ tx=${tx.transaction_hash.slice(0, 18)}… fee=${fee.toFixed(5)} STRK`);
    return { tx, rcpt };
}

function canonicalize(v) {
    if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
}
function sha240(obj) {
    // Truncate to 240 bits: full 256-bit digests overflow felt252 ("felt overflow" gotcha).
    return "0x" + createHash("sha256").update(canonicalize(obj)).digest("hex").slice(0, 60);
}

async function viewOn(addr, name, cd = []) {
    const sel = BigInt("0x" + hash.starknetKeccak(name).toString(16)) & MASK;
    const body = { jsonrpc: "2.0", id: 1, method: "starknet_call", params: [{ contract_address: addr, entry_point_selector: "0x" + sel.toString(16), calldata: cd.map(v => "0x" + BigInt(v).toString(16)) }, "latest"] };
    const r = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    if (r.error) throw new Error(name + ": " + JSON.stringify(r.error).slice(0, 150));
    return r.result;
}

function assertEq(actual, expected, label) {
    const a = Array.isArray(actual) ? actual[0] : actual;
    const ok = BigInt(a) === BigInt(expected);
    console.log(`[verify] ${label}: ${ok ? "✅" : "❌ got " + a}`);
    if (!ok) throw new Error(`VERIFY FAIL: ${label} — expected ${expected}, got ${a}`);
}
function deployedAddress(deployResult) {
    const a = deployResult.contract_address ?? deployResult.address;
    return Array.isArray(a) ? a[0] : a;
}

// ── Evidence accumulator (fail-closed) ──
const evidence = {
    network: "sepolia",
    test: "honest round v3 (two independent wallets + balance-observed trade values)",
    started_at: new Date().toISOString(),
    arena_class_hash: NEW_ARENA_CLASS,
    adapter_class_hash: ADAPTER_CLASS,
    usd_token: USD_TOKEN,
    sponsor: sponsor.address,
    tortoise_wallet: tortoiseWallet.address,
    falcon_wallet: falconWallet.address,
    steps: [],
    status: "RUNNING",
};
function step(name, obj) { const s = { step: name, ...obj }; evidence.steps.push(s); return s; }

const OUT_PATH = `${ROOT}/.local/open-round-evidence.json`;
const PREV_PATH = `${ROOT}/.local/open-round-evidence.round1-flawed.json`;
function writeEvidenceAtomic() {
    const tmp = OUT_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(evidence, null, 2) + "\n");
    renameSync(tmp, OUT_PATH);
}
function finish(exitCode) {
    evidence.status = exitCode === 0 ? "VERIFIED" : "FAILED";
    evidence.finished_at = new Date().toISOString();
    // Archive the previous flawed run's evidence once, then overwrite with this run's result.
    if (!existsSync(PREV_PATH)) { try { copyFileSync(OUT_PATH, PREV_PATH); } catch {} }
    writeEvidenceAtomic();
}
let exitCode = 0;
try {
    process.exitCode = await runMain();
} catch (err) {
    exitCode = 1;
    console.error("\n[ABORT]", String(err?.message ?? err).slice(0, 300));
    evidence.error = String(err?.message ?? err).slice(0, 500);
    finish(1);
    process.exitCode = 1;
}

async function runMain() {
    // ── Round timing (fresh timestamps each run) ──
    const blkRes = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_getBlockWithTxHashes", params: ["latest"] }) }).then(r => r.json());
    const blockTime = Number(blkRes.result.timestamp);
    const startTime = BigInt(blockTime + 420); // 7 min: deploy + setup + registrations must land BEFORE start
    const endTime = startTime + 300n;
    const rulesCommitment = sha240({ startTime: startTime.toString(), endTime: endTime.toString() });
    console.log(`\n[timing] start: +420s, end: +720s | rules: ${rulesCommitment}`);

    // ═══ Deploy Arena + Adapter via SDK deployContract (address returned directly —
    // no UDC event scraping, which is where the round-1 wrong-address bug lived) ═══
    console.log("\n=== Deploying ===\n");
    step("timing", { start_time: Number(startTime), end_time: Number(endTime), rules_commitment: rulesCommitment });

    const arenaConstructorCd = [
        sponsor.address,
        startTime, endTime,
        1000n,   // starting_units
        3500n,   // max_allocation_bps
        2000n,   // max_drawdown_bps
        100n,    // prize_cap_units
        USD_TOKEN,
        1n, USD_TOKEN,      // initial_assets span
        1n, TRADE_TARGET,   // initial_targets span
        rulesCommitment,
    ];
    const arenaDeployTx = await sponsor.deployContract(
        { classHash: NEW_ARENA_CLASS, constructorCalldata: arenaConstructorCd.map(v => typeof v === "bigint" ? "0x" + v.toString(16) : v) },
        { tip: TIP },
    );
    let arenaRcpt = await provider.waitForTransaction(arenaDeployTx.transaction_hash);
    if (arenaRcpt.execution_status === "REVERTED") throw new Error("Arena deploy reverted: " + String(arenaRcpt.revert_reason).slice(0, 150));
    // ONE canonical address for the entire run — every later call uses THIS constant.
    const ARENA_ADDR = deployedAddress(arenaDeployTx);
    console.log("[Arena]", ARENA_ADDR);
    step("deploy_arena", { tx: arenaDeployTx.transaction_hash, arena: ARENA_ADDR });

    const adapterTx = await sponsor.deployContract(
        { classHash: ADAPTER_CLASS, constructorCalldata: ["0x0", ARENA_ADDR] },
        { tip: TIP },
    );
    const adapterRcpt = await provider.waitForTransaction(adapterTx.transaction_hash);
    if (adapterRcpt.execution_status === "REVERTED") throw new Error("Adapter deploy reverted");
    const adapterAddr = deployedAddress(adapterTx);
    console.log("[Adapter]", adapterAddr);
    step("deploy_adapter", { tx: adapterTx.transaction_hash, adapter: adapterAddr });

    // Liveness check on the exact address we will use for everything else.
    assertEq(await viewOn(ARENA_ADDR, "get_action_adapter"), 0n, "Arena live & action_adapter unset pre-setup");

    // ── Setup (sponsor): mint floats, bind adapter, set price ──
    console.log("\n=== Setup ===\n");
    const { tx: setupTx } = await sendTx(sponsor, "setup", [
        { contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [tortoiseWallet.address, "50000", "0"] },
        { contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [falconWallet.address, "50000", "0"] },
        { contractAddress: ARENA_ADDR, entrypoint: "set_action_adapter", calldata: [adapterAddr] },
        { contractAddress: ARENA_ADDR, entrypoint: "set_price", calldata: [USD_TOKEN, "1000000000000000000"] },
    ]);
    step("setup", { tx: setupTx.transaction_hash });

    // Per HANDOFF: after setup → get_action_adapter ≠ 0 (read from THE arena)
    assertEq(await viewOn(ARENA_ADDR, "get_action_adapter"), adapterAddr, "adapter bound on THE arena");
    const priceTs = await viewOn(ARENA_ADDR, "get_price_timestamp", [USD_TOKEN]);
    if (BigInt(priceTs[0]) === 0n) throw new Error("VERIFY FAIL: price timestamp zero");
    console.log("[verify] USD price set @ ts", Number(priceTs[0]), "✅");

    // ── Register each strategy from its OWN wallet (two independent agents) ──
    console.log("\n=== Registration (independent wallets) ===\n");
    const tortoiseDesc = "Conservative compounder with small allocations and low drawdown";
    const falconDesc = "Aggressive momentum push with high allocation";
    const tortoiseCommitment = sha240({ describe: tortoiseDesc, alloc: 0.25 });
    const falconCommitment = sha240({ describe: falconDesc, alloc: 0.35 });
    step("commitments", {
        tortoise: { commitment: tortoiseCommitment, describe: tortoiseDesc, wallet: tortoiseWallet.address },
        falcon: { commitment: falconCommitment, describe: falconDesc, wallet: falconWallet.address },
        derived_by: "sha256(canonicalJson) truncated to 240 bits",
    });

    async function registerStrategy(wallet, label, commitment, desc) {
        const { tx } = await sendTx(wallet, `register:${label}`, [{ contractAddress: ARENA_ADDR, entrypoint: "register_strategy", calldata: [commitment] }]);
        // Per HANDOFF: after register → get_registrant(commitment) == submitter, ON THE SAME arena.
        assertEq(await viewOn(ARENA_ADDR, "get_registrant", [commitment]), wallet.address, `${label} registrant == own wallet`);
        step(`register_${label.toLowerCase()}`, { tx: tx.transaction_hash, commitment, registrant: wallet.address });
    }
    await registerStrategy(tortoiseWallet, "Tortoise", tortoiseCommitment, tortoiseDesc);
    await registerStrategy(falconWallet, "Falcon", falconCommitment, falconDesc);

    // ── Prize escrow (sponsor) ──
    console.log("\n=== Prize ===\n");
    const { tx: apprTx } = await sendTx(sponsor, "approve_prize", [{ contractAddress: USD_TOKEN, entrypoint: "approve", calldata: [ARENA_ADDR, "100", "0"] }]);
    const { tx: depTx } = await sendTx(sponsor, "deposit_prize", [{ contractAddress: ARENA_ADDR, entrypoint: "deposit_prize", calldata: ["100"] }]);
    assertEq(await viewOn(ARENA_ADDR, "get_prize_deposited"), 100n, "prize deposited == 100");
    step("prize_escrow", { approve_tx: apprTx.transaction_hash, deposit_tx: depTx.transaction_hash, amount: 100 });

    // ── Wait for round start, then submit actions ──
    const waitSec = Number(startTime) - Math.floor(Date.now() / 1000) + 5;
    if (waitSec > 0) { console.log(`\nwaiting ${waitSec}s for round start...`); await new Promise(r => setTimeout(r, waitSec * 1000)); }

    console.log("\n=== Agent Actions (balance-observed) ===\n");
    // open_submit_action(receipt_id, strategy_commitment, asset, target, allocation_units,
    //                    portfolio_value_before, portfolio_value_after, drawdown_bps)
    // f1 fix: value_after is NOT invented. Each wallet executes a REAL transfer through the
    // whitelisted target; value_before/value_after/drawdown are DERIVED from balance_of reads
    // taken before and after the transfer. Contract rule honored: first action requires
    // value_before == starting_units (1000), so each wallet's float is minted to exactly 1000.
    async function submitObservedAction(wallet, label, receiptIdHex, commitment, spendUnits) {
        // Float normalization to exactly 1000 whole units (18 decimals).
        // Deficit → sponsor mints the difference. Surplus → the WALLET pushes its own
        // excess to the whitelisted target (sponsor holds ~0 TestUSD, can't pull it back).
        const UNIT = 10n ** 18n;
        const raw = await viewOn(USD_TOKEN, "balance_of", [wallet.address]);
        const balRaw = BigInt(Array.isArray(raw) ? raw[0] : raw);
        const targetRaw = 1000n * UNIT;
        if (balRaw < targetRaw) {
            await sendTx(sponsor, `float:${label}`, [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [wallet.address, "0x" + (targetRaw - balRaw).toString(16), "0"] }]);
        } else if (balRaw > targetRaw) {
            await sendTx(wallet, `float-trim:${label}`, [{ contractAddress: USD_TOKEN, entrypoint: "transfer", calldata: [TRADE_TARGET, "0x" + (balRaw - targetRaw).toString(16), "0"] }]);
        }
        const preRaw = BigInt((await viewOn(USD_TOKEN, "balance_of", [wallet.address]))[0]);
        const preUnits = Number(preRaw / UNIT);
        if (preUnits !== 1000) throw new Error(`FAIL-CLOSED: ${label} float != 1000 units (got ${preUnits})`);

        // REAL trade: transfer spendUnits of TestUSD to the whitelisted target.
        const { tx } = await sendTx(wallet, `trade:${label}`, [{
            contractAddress: USD_TOKEN, entrypoint: "transfer",
            calldata: [TRADE_TARGET, String(spendUnits), "0"],
        }]);

        const postRaw = BigInt((await viewOn(USD_TOKEN, "balance_of", [wallet.address]))[0]);
        const afterUnits = Number(postRaw / UNIT);
        const delta = preUnits - afterUnits;
        const spendWhole = Number(spendUnits / UNIT); // whole units — raw wei would overflow u16 drawdown_bps
        const allocBpsOfValue = Math.floor((spendWhole * 10000) / preUnits);
        console.log(`[${label}] observed: ${preUnits} → ${afterUnits} units (Δ−${delta})`);

        const call = await sendTx(wallet, `action:${label}`, [{
            contractAddress: ARENA_ADDR, entrypoint: "open_submit_action",
            calldata: [receiptIdHex, commitment, USD_TOKEN, TRADE_TARGET, String(delta),
                String(preUnits), String(afterUnits), String(allocBpsOfValue)],
        }]);
        // Parse ActionSubmitted events from THIS tx to see the contract's internal verdict.
        // Raw RPC layout: keys=[event_selector, receipt_id, strategy_commitment], data=[accepted]
        const evs = (call.rcpt.events ?? []).filter(e =>
            BigInt(e.from_address) === BigInt(ARENA_ADDR)
            && e.keys.length === 3 && e.data.length >= 1
            && BigInt(e.keys[2]) === BigInt(commitment));
        let accepted = null;
        for (const e of evs) {
            try { accepted = BigInt(e.data[0]) === 1n; } catch {}
        }
        console.log(`[${label}] contract verdict: ${accepted === null ? "NO EVENT FOUND" : accepted ? "ACCEPTED" : "REJECTED"}`);
        // Per HANDOFF: after each action → get_action_counts incremented ON THE SAME arenaAddr.
        const counts = await viewOn(ARENA_ADDR, "get_action_counts", [commitment]);
        const acc = Number(counts[0]), rej = Number(counts[1]);
        console.log(`[verify] ${label} action counts on THE arena: accepted=${acc} rejected=${rej}`);
        return {
            label, tx: tx.transaction_hash, submit_tx: call.tx.transaction_hash, receipt_id: receiptIdHex,
            verdict: accepted === null ? "NO_EVENT" : accepted ? "ACCEPTED" : "REJECTED", accepted,
            accepted_count: acc, rejected_count: rej,
            observed: true, operator: wallet.address, whitelisted_target: TRADE_TARGET,
            pre_balance_units: preUnits, post_balance_units: afterUnits,
            allocation_units: delta, portfolio_value_before: preUnits, portfolio_value_after: afterUnits,
            drawdown_bps: allocBpsOfValue,
        };
    }

    const tRes = await submitObservedAction(tortoiseWallet, "Tortoise", "0x746f72746f6973652d68303032", tortoiseCommitment, 20n * 10n ** 18n);
    if (!(tRes.accepted === true && tRes.accepted_count === 1)) {
        throw new Error(`FAIL-CLOSED: Tortoise action not accepted on-chain (verdict=${tRes.verdict}, counts=${tRes.accepted_count}/${tRes.rejected_count})`);
    }
    step("tortoise_action", tRes);

    const fRes = await submitObservedAction(falconWallet, "Falcon", "0x66616c636f6e2d68303032", falconCommitment, 5n * 10n ** 18n);
    if (!(fRes.accepted === true && fRes.accepted_count === 1)) {
        throw new Error(`FAIL-CLOSED: Falcon action not accepted on-chain (verdict=${fRes.verdict}, counts=${fRes.accepted_count}/${fRes.rejected_count}) — abort before close so a bad demo can never be presented as success`);
    }
    step("falcon_action", fRes);

    // ── Wait for end, advance blocks, close & settle ──
    console.log("\n=== Close & Settle ===\n");
    const waitEnd = Number(endTime) - Math.floor(Date.now() / 1000) + 10;
    if (waitEnd > 0) { console.log(`waiting ${waitEnd}s for round end...`); await new Promise(r => setTimeout(r, waitEnd * 1000)); }

    // Advance blocks (Sepolia timestamps freeze without txs).
    for (let i = 0; i < 2; i++) {
        await sendTx(sponsor, `advance-${i}`, [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [sponsor.address, "1", "0"] }]);
    }
    step("advance_blocks", { mints: 2 });

    const { tx: closeTx } = await sendTx(sponsor, "close", [{ contractAddress: ARENA_ADDR, entrypoint: "close", calldata: [] }]);
    step("close", { tx: closeTx.transaction_hash });

    const winnerResult = await viewOn(ARENA_ADDR, "get_winner");
    const winnerCommitment = winnerResult[0];
    const winnerName = winnerCommitment === falconCommitment ? "FALCON" : winnerCommitment === tortoiseCommitment ? "TORTOISE" : `UNKNOWN(${winnerCommitment})`;
    console.log("[winner]", winnerName, winnerCommitment);

    const { tx: settleTx } = await sendTx(sponsor, "settle", [{ contractAddress: ARENA_ADDR, entrypoint: "settle", calldata: ["100"] }]);
    const settlement = await viewOn(ARENA_ADDR, "get_settlement");
    assertEq(settlement[0], winnerCommitment, "settled winner == derived winner");
    assertEq(settlement[1], 100n, "settled amount == 100");
    step("settle", { tx: settleTx.transaction_hash, winner: winnerName, amount: Number(BigInt(settlement[1])) });

    // Final independent cross-checks against chain state (the whole point of this fix).
    const finalCountsT = await viewOn(ARENA_ADDR, "get_action_counts", [tortoiseCommitment]);
    const finalCountsF = await viewOn(ARENA_ADDR, "get_action_counts", [falconCommitment]);
    evidence.final_state = {
        arena: ARENA_ADDR,
        adapter: adapterAddr,
        rules_commitment_onchain: (await viewOn(ARENA_ADDR, "rules_commitment"))[0],
        tortoise_wallet: tortoiseWallet.address,
        falcon_wallet: falconWallet.address,
        tortoise_accepted: Number(finalCountsT[0]),
        falcon_accepted: Number(finalCountsF[0]),
        winner: winnerName,
        settlement_amount: Number(BigInt(settlement[1])),
        value_observation: "portfolio_value_after derived from balance_of reads around real transfers",
    };

    console.log(`
════════════════════════════════════════
  HONEST ROUND v3 — TWO WALLETS, BALANCE-OBSERVED VALUES — CHAIN-VERIFIED

  Arena:   ${ARENA_ADDR}
  Winner:  ${winnerName} (derived on-chain, settled)
  Tortoise accepted actions: ${finalCountsT[0]}
  Falcon   accepted actions: ${finalCountsF[0]}
  Every step verified via view calls on THE SAME arena.
════════════════════════════════════════`);

    finish(0);
    console.log("\n[evidence] written:", OUT_PATH);
    return 0;
}
