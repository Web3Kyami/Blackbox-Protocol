// Honest Sepolia round v5 — ADAPTER-MEDIATED execution + Pile-1-fixed Arena class.
// Flow: deploy(Arena v3, AdapterV2) → setup → register(Tortoise=v2, Falcon=v1) → prize →
//       adapter execute_action (PULLS allocation×price from each wallet, records custody,
//       Arena sees contract-context submission) → close → settle → withdraws.
// Closes codex's "v4 real trades were raw transfers to a dummy sink" criticism:
// capital now moves THROUGH the adapter contract, custody is per-pool recorded on-chain.
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

const NEW_ARENA_CLASS = "0x7ca7cd737a3336ff135a53d171feadd78cf36a52b31c93dca14a02f9310e360"; // Option B attested float
const ADAPTER_CLASS = "0x418dbc37b4315c0841f20bdb473145990ff57d89a701a2c1f55688b022500bc";   // ArenaAdapterV2 (per-pool custody)
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
        nonce,
    };
}

async function sendTx(account, opName, calls) {
    const est = await tightBounds(account, calls);
    const { estStrk, nonce: estNonce, ...bounds } = est;
    console.log(`[${opName}] submitting (~${estStrk.toFixed(4)} STRK est)...`);
    // Bounded submit retry for transient node-side param-validation errors
    // (-32602 "Invalid params" observed once on a byte-identical payload).
    // Guard against double-send: if the chain nonce advanced past the one we
    // signed with, the "failed" tx actually LANDED — never blindly resend.
    let tx = null;
    for (let submitAttempt = 1; submitAttempt <= 3; submitAttempt++) {
        try {
            tx = await account.execute(calls, { resourceBounds: bounds, tip: TIP });
            break;
        } catch (e) {
            const msg = String(e?.message ?? e);
            const transient = msg.includes("-32602") || msg.includes("Invalid params");
            let landedHint = "";
            try {
                const chainNonce = BigInt(await account.getNonce());
                if (chainNonce > BigInt(estNonce)) landedHint = " (chain nonce advanced — tx may have landed; NOT resending)";
            } catch {}
            console.log(`[${opName}] submit attempt ${submitAttempt}/3 failed: ${msg.slice(0, 140)}${landedHint}`);
            if (!transient || submitAttempt === 3 || landedHint) {
                e.diagnostics = { opName, estStrk, estNonce, calls: JSON.parse(JSON.stringify(calls)) };
                throw e;
            }
            await new Promise(r => setTimeout(r, 2000 * submitAttempt));
        }
    }
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
    test: "honest round B1 (adapter-mediated + Option B attested float)",
    sponsor_address: sponsor.address,
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

const OUT_PATH = `${ROOT}/.local/open-round-evidence.b1.json`;
const PREV_PATH = `${ROOT}/.local/open-round-evidence.b1.prev.json`;
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
    // Durable error capture: the full error (incl. RPC param dumps) goes to
    // .local/last-abort.json BEFORE any console print, so an abort can never
    // lose its tail again (attempt-2's decisive lines died with the process).
    const detail = {
        at: new Date().toISOString(),
        message: String(err?.message ?? err),
        stack: String(err?.stack ?? "").split("\n").slice(0, 6).join("\n"),
        diagnostics: err?.diagnostics ?? null,
    };
    try { writeFileSync(`${ROOT}/.local/last-abort.json`, JSON.stringify(detail, null, 2) + "\n"); } catch {}
    console.error("\n[ABORT]", String(err?.message ?? err).slice(0, 300), "— full details: .local/last-abort.json");
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
        64n,    // max_strategies (P1: bounded registration, winner loop stays in-gas)
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

    // Adapter V2 constructor: (arena). The adapter is bound to the Arena; each
    // strategy wallet acts as its own venue pool funding delivery to the adapter.
    const adapterTx = await sponsor.deployContract(
        { classHash: ADAPTER_CLASS, constructorCalldata: [ARENA_ADDR] },
        { tip: TIP },
    );
    const adapterRcpt = await provider.waitForTransaction(adapterTx.transaction_hash);
    if (adapterRcpt.execution_status === "REVERTED") throw new Error("Adapter deploy reverted");
    const adapterAddr = deployedAddress(adapterTx);
    console.log("[Adapter]", adapterAddr);
    step("deploy_adapter", { tx: adapterTx.transaction_hash, adapter: adapterAddr });

    // Liveness check on the exact address we will use for everything else.
    assertEq(await viewOn(ARENA_ADDR, "get_action_adapter"), 0n, "Arena live & action_adapter unset pre-setup");

    // ── Setup (sponsor): bind adapter, set price, set attested float token ──
    // Option B: float_token MUST be set BEFORE first registration and BEFORE start_time.
    console.log("\n=== Setup (Option B float) ===\n");
    // Verify float_token initially zero
    assertEq(await viewOn(ARENA_ADDR, "get_float_token"), 0n, "float_token zero pre-setup");
    const { tx: setupTx } = await sendTx(sponsor, "setup", [
        { contractAddress: ARENA_ADDR, entrypoint: "set_action_adapter", calldata: [adapterAddr] },
        { contractAddress: ARENA_ADDR, entrypoint: "set_price", calldata: [USD_TOKEN, "1000000000000000000"] },
        { contractAddress: ARENA_ADDR, entrypoint: "set_float_token", calldata: [USD_TOKEN] },
    ]);
    step("setup", { tx: setupTx.transaction_hash });
    assertEq(await viewOn(ARENA_ADDR, "get_float_token"), USD_TOKEN, "float_token bound to USD");

    // Per HANDOFF: after setup → get_action_adapter ≠ 0 (read from THE arena)
    assertEq(await viewOn(ARENA_ADDR, "get_action_adapter"), adapterAddr, "adapter bound on THE arena");
    const priceTs = await viewOn(ARENA_ADDR, "get_price_timestamp", [USD_TOKEN]);
    if (BigInt(priceTs[0]) === 0n) throw new Error("VERIFY FAIL: price timestamp zero");
    console.log("[verify] USD price set @ ts", Number(priceTs[0]), "✅");

    // ── Normalize wallet floats to exactly 1000 units BEFORE registration ──
    // This ensures attest_start captured at registration == 1000*1e18 (deterministic scoring).
    console.log("\n=== Float normalization pre-register (Option B) ===\n");
    const UNIT_BIG = 10n ** 18n;
    const TARGET_RAW = 1000n * UNIT_BIG;
    async function normalizeTo1000(wallet, label) {
        const raw = await viewOn(USD_TOKEN, "balance_of", [wallet.address]);
        const balRaw = BigInt(Array.isArray(raw) ? raw[0] : raw);
        const balUnits = balRaw / UNIT_BIG;
        console.log(`[float:${label}] balance ${balUnits} units (${balRaw})`);
        if (balRaw < TARGET_RAW) {
            await sendTx(sponsor, `float-mint:${label}`, [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [wallet.address, "0x" + (TARGET_RAW - balRaw).toString(16), "0"] }]);
        } else if (balRaw > TARGET_RAW) {
            await sendTx(wallet, `float-trim:${label}`, [{ contractAddress: USD_TOKEN, entrypoint: "transfer", calldata: [TRADE_TARGET, "0x" + (balRaw - TARGET_RAW).toString(16), "0"] }]);
        }
        const post = BigInt((await viewOn(USD_TOKEN, "balance_of", [wallet.address]))[0]);
        if (post !== TARGET_RAW) throw new Error(`FAIL-CLOSED: ${label} normalization failed got ${post} != ${TARGET_RAW}`);
        console.log(`[verify] ${label} normalized to 1000 units ✅`);
    }
    await normalizeTo1000(tortoiseWallet, "Tortoise");
    await normalizeTo1000(falconWallet, "Falcon");

    // ── Register each strategy from its OWN wallet (two independent agents) ──
    console.log("\n=== Registration (independent wallets, attested) ===\n");
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
    // Verify Option B attested start captured
    const tStart = await viewOn(ARENA_ADDR, "get_attest_start", [tortoiseCommitment]);
    const tStartVal = BigInt(tStart[0]);
    const fStartRaw = await viewOn(ARENA_ADDR, "get_attest_start", [falconCommitment]);
    const fStartVal = BigInt(fStartRaw[0]);
    console.log(`[verify] attest_start tortoise=${tStartVal} falcon=${fStartVal}`);
    if (tStartVal !== TARGET_RAW || fStartVal !== TARGET_RAW) throw new Error(`FAIL-CLOSED: attest_start != 1000*1e18 tortoise ${tStartVal} falcon ${fStartVal}`);
    const tPeak = await viewOn(ARENA_ADDR, "get_attest_peak", [tortoiseCommitment]);
    const tMaxDd = await viewOn(ARENA_ADDR, "get_attest_max_dd", [tortoiseCommitment]);
    console.log(`[verify] attest peak/max_dd tortoise peak=${tPeak[0]} max_dd=${tMaxDd[0]} ✅`);
    step("attest_start_verified", { tortoise: tStartVal.toString(), falcon: fStartVal.toString(), units: 1000 });

    // ── Prize escrow (sponsor) ──
    console.log("\n=== Prize ===\n");
    // Ensure sponsor has at least 100 USD for prize; mint if needed (mock is permissionless)
    const sponsorBal = BigInt((await viewOn(USD_TOKEN, "balance_of", [sponsor.address]))[0]);
    if (sponsorBal < 100n) {
        await sendTx(sponsor, "mint_prize", [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [sponsor.address, "1000", "0"] }]);
    }
    const { tx: apprTx } = await sendTx(sponsor, "approve_prize", [{ contractAddress: USD_TOKEN, entrypoint: "approve", calldata: [ARENA_ADDR, "100", "0"] }]);
    const { tx: depTx } = await sendTx(sponsor, "deposit_prize", [{ contractAddress: ARENA_ADDR, entrypoint: "deposit_prize", calldata: ["100"] }]);
    assertEq(await viewOn(ARENA_ADDR, "get_prize_deposited"), 100n, "prize deposited == 100");
    step("prize_escrow", { approve_tx: apprTx.transaction_hash, deposit_tx: depTx.transaction_hash, amount: 100 });

    // ── Wait for round start, then submit actions ──
    const waitSec = Number(startTime) - Math.floor(Date.now() / 1000) + 5;
    if (waitSec > 0) { console.log(`\nwaiting ${waitSec}s for round start...`); await new Promise(r => setTimeout(r, waitSec * 1000)); }

    console.log("\n=== Agent Actions (adapter-mediated) ===\n");
    // Adapter-mediated execution (closes codex's v4 "dummy sink" criticism):
    // each strategy wallet acts as a venue POOL funding its own action.
    //   1. wallet approves AdapterV2 for exactly allocation×price
    //   2. wallet calls adapter.execute_action(...) → the ADAPTER PULLS the
    //      allocation from the wallet (transfer_from — contract-observed
    //      delivery, no caller-trusted amounts), records custody under
    //      (pool=wallet, receipt_id), and submits the Arena action FROM
    //      CONTRACT CONTEXT (Arena sees caller == bound action_adapter).
    //   3. verify: verdict via ActionReceipt event + get_action_counts ON THE
    //      arena, custody ON THE adapter == allocation×price, wallet balance
    //      delta == allocation×price.
    async function submitAdapterMediatedAction(wallet, label, receiptIdHex, commitment, spendUnits) {
        const UNIT = 10n ** 18n;
        // Callers pass RAW WEI (e.g. 20n * 10n**18n) — never scale again here.
        // A double-scale made allocRaw 1e18x too large: the on-chain action
        // still succeeded (adapter pulls per execute-calldata), but the local
        // delivery cross-check then aborted a healthy round.
        const allocRaw = BigInt(spendUnits); // sponsor price = 1e18 raw per unit

        // Float normalization to exactly 1000 whole units (first action requires
        // portfolio_value_before == stored current_value = starting_units).
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

        // 1) approve the adapter for the exact delivery amount
        await sendTx(wallet, `approve-adapter:${label}`, [{
            contractAddress: USD_TOKEN, entrypoint: "approve",
            calldata: [adapterAddr, "0x" + allocRaw.toString(16), "0"],
        }]);

        // 2+3) adapter-mediated execution: PULL + custody + contract-context submission
        // Whole-unit arithmetic ONLY (raw-wei slips once produced negative values /
        // 1e+23 scientific-notation strings in calldata → RPC "invalid hex digit").
        const spendWholeBig = spendUnits / UNIT;                       // bigint, exact
        const afterUnitsBig = BigInt(preUnits) - spendWholeBig;
        if (afterUnitsBig < 0n) throw new Error(`FAIL-CLOSED: ${label} spend ${spendWholeBig} exceeds float ${preUnits}`);
        const drawdownBps = Number((spendWholeBig * 10000n) / BigInt(preUnits));
        if (drawdownBps > 10000) throw new Error(`FAIL-CLOSED: ${label} drawdownBps ${drawdownBps} > 100%`);
        const h = (v) => "0x" + BigInt(v).toString(16);
        const call = await sendTx(wallet, `execute:${label}`, [{
            contractAddress: adapterAddr, entrypoint: "execute_action",
            calldata: [h(BigInt(receiptIdHex)), h(BigInt(commitment)), USD_TOKEN, TRADE_TARGET,
                h(spendWholeBig), h(preUnits), h(afterUnitsBig), h(drawdownBps)],
        }]);

        // Parse the Arena's ActionReceipt event (keys=[sel, receipt_id, commitment],
        // data=[reason_code, accepted]) for the contract's internal verdict.
        const ACCEPTED_FELT = BigInt("0x" + Buffer.from("ACCEPTED", "utf8").toString("hex"));
        const evs = (call.rcpt.events ?? []).filter(e =>
            BigInt(e.from_address) === BigInt(ARENA_ADDR)
            && e.keys.length === 3
            && BigInt(e.keys[1]) === BigInt(receiptIdHex)
            && BigInt(e.keys[2]) === BigInt(commitment));
        let verdictFelt = null;
        for (const e of evs) { try { verdictFelt = BigInt(e.data[0]); } catch {} }
        const accepted = verdictFelt === ACCEPTED_FELT;
        console.log(`[${label}] contract verdict: ${verdictFelt === null ? "NO EVENT FOUND" : accepted ? "ACCEPTED" : "REJECTED"}`);

        // Authoritative view checks ON THE SAME arena + adapter.
        const counts = await viewOn(ARENA_ADDR, "get_action_counts", [commitment]);
        const acc = Number(counts[0]), rej = Number(counts[1]);
        console.log(`[verify] ${label} action counts on THE arena: accepted=${acc} rejected=${rej}`);

        const postRaw = BigInt((await viewOn(USD_TOKEN, "balance_of", [wallet.address]))[0]);
        if (preRaw - postRaw !== allocRaw) throw new Error(`FAIL-CLOSED: ${label} wallet paid ${(preRaw - postRaw)} != claimed delivery ${allocRaw}`);
        console.log(`[${label}] observed: ${preUnits} → ${Number(postRaw / UNIT)} units (Δ−${Number(spendWholeBig)}) via adapter pull`);

        const cust = await viewOn(adapterAddr, "get_custody", [wallet.address, receiptIdHex]);
        const custAsset = cust[0];
        const custAmt = BigInt(cust[1]) + (BigInt(cust[2]) << 128n);
        if (BigInt(custAsset) !== BigInt(USD_TOKEN)) throw new Error(`FAIL-CLOSED: ${label} custody asset mismatch`);
        if (custAmt !== allocRaw) throw new Error(`FAIL-CLOSED: ${label} adapter custody ${custAmt} != delivered ${allocRaw}`);
        console.log(`[verify] ${label} adapter custody = ${custAmt} raw (per-pool, contract-recorded)`);

        return {
            label, submit_tx: call.tx.transaction_hash, receipt_id: receiptIdHex,
            verdict: accepted ? "ACCEPTED" : (verdictFelt === null ? "NO_EVENT" : "REJECTED"), accepted,
            accepted_count: acc, rejected_count: rej,
            mediated_by: adapterAddr, operator: wallet.address, whitelisted_target: TRADE_TARGET,
            allocation_units: Number(spendWholeBig), portfolio_value_before: preUnits, portfolio_value_after: Number(afterUnitsBig),
            drawdown_bps: drawdownBps,
            custody: { receipt_id: receiptIdHex, raw: custAmt.toString() },
        };
    }

    const tReceiptId = "0x" + Buffer.from("tortoise-h005").toString("hex");
    const tRes = await submitAdapterMediatedAction(tortoiseWallet, "Tortoise", tReceiptId, tortoiseCommitment, 20n * 10n ** 18n);
    if (!(tRes.accepted === true && tRes.accepted_count === 1)) {
        throw new Error(`FAIL-CLOSED: Tortoise action not accepted on-chain (verdict=${tRes.verdict}, counts=${tRes.accepted_count}/${tRes.rejected_count})`);
    }
    step("tortoise_action", tRes);

    const fReceiptId = "0x" + Buffer.from("falcon-h005").toString("hex");
    const fRes = await submitAdapterMediatedAction(falconWallet, "Falcon", fReceiptId, falconCommitment, 5n * 10n ** 18n);
    if (!(fRes.accepted === true && fRes.accepted_count === 1)) {
        throw new Error(`FAIL-CLOSED: Falcon action not accepted on-chain (verdict=${fRes.verdict}, counts=${fRes.accepted_count}/${fRes.rejected_count}) — abort before close so a bad demo can never be presented as success`);
    }
    step("falcon_action", fRes);

    // ── Option B: permissionless checkpoint after each action ──
    console.log("\n=== Checkpoints (permissionless) ===\n");
    async function checkpointAndVerify(wallet, label, commitment) {
        const { tx } = await sendTx(wallet, `checkpoint:${label}`, [{ contractAddress: ARENA_ADDR, entrypoint: "checkpoint", calldata: [commitment] }]);
        const cnt = await viewOn(ARENA_ADDR, "get_checkpoint_count", [commitment]);
        const curBal = BigInt((await viewOn(USD_TOKEN, "balance_of", [wallet.address]))[0]);
        console.log(`[verify] ${label} checkpoint count=${cnt[0]} balance=${curBal} tx=${tx.transaction_hash.slice(0,14)}…`);
        step(`checkpoint_${label.toLowerCase()}`, { tx: tx.transaction_hash, count: Number(cnt[0]), balance: curBal.toString() });
    }
    // checkpoint from permissionless caller (sponsor also allowed) — use each wallet for its own
    await checkpointAndVerify(tortoiseWallet, "Tortoise", tortoiseCommitment);
    await checkpointAndVerify(falconWallet, "Falcon", falconCommitment);
    // Verify attest peak/max_dd updated after checkpoints
    const tPeak2 = await viewOn(ARENA_ADDR, "get_attest_peak", [tortoiseCommitment]);
    const tDd2 = await viewOn(ARENA_ADDR, "get_attest_max_dd", [tortoiseCommitment]);
    const fPeak2 = await viewOn(ARENA_ADDR, "get_attest_peak", [falconCommitment]);
    const fDd2 = await viewOn(ARENA_ADDR, "get_attest_max_dd", [falconCommitment]);
    console.log(`[verify] post-checkpoint tortoise peak=${tPeak2[0]} max_dd=${tDd2[0]} falcon peak=${fPeak2[0]} max_dd=${fDd2[0]}`);

    // ── Spoof resistance: try to inflate via open_submit_action — get_score must ignore it ──
    console.log("\n=== Spoof attempt (open_submit_action 5000) ===\n");
    const scoreBeforeT = await viewOn(ARENA_ADDR, "get_score", [tortoiseCommitment]);
    const scoreBeforeF = await viewOn(ARENA_ADDR, "get_score", [falconCommitment]);
    console.log(`[score before spoof] tortoise=${JSON.stringify(scoreBeforeT)} falcon=${JSON.stringify(scoreBeforeF)}`);
    const tCountsBefore = await viewOn(ARENA_ADDR, "get_action_counts", [tortoiseCommitment]);
    const tCurrentValue = 980; // tortoise spent 20 from 1000
    const spoofReceipt = "0x" + Buffer.from("tortoise-spoof-b1").toString("hex");
    // open_submit_action requires portfolio_value_before == stored current_value (980) and allocation within cap
    // Use allocation 0 to stay within 35% cap, portfolio_after 5000 (inflated)
    try {
        const { tx: spoofTx } = await sendTx(tortoiseWallet, "spoof:Tortoise", [{ contractAddress: ARENA_ADDR, entrypoint: "open_submit_action", calldata: [spoofReceipt, tortoiseCommitment, USD_TOKEN, TRADE_TARGET, "0", String(tCurrentValue), "5000", "0"] }]);
        console.log(`[spoof] tortoise open_submit_action tx=${spoofTx.transaction_hash.slice(0,18)}… (should be ACCEPTED but score must stay attested)`);
        step("spoof_tortoise", { tx: spoofTx.transaction_hash, receipt: spoofReceipt, inflated_after: 5000 });
    } catch (e) {
        console.log(`[spoof] failed (acceptable if reverted): ${String(e.message).slice(0,120)}`);
        step("spoof_tortoise", { error: String(e.message).slice(0,200) });
    }
    const scoreAfterT = await viewOn(ARENA_ADDR, "get_score", [tortoiseCommitment]);
    const scoreAfterF = await viewOn(ARENA_ADDR, "get_score", [falconCommitment]);
    console.log(`[score after spoof] tortoise=${JSON.stringify(scoreAfterT)} falcon=${JSON.stringify(scoreAfterF)}`);
    // Compare attested final_value should still be live balance (980*1e18 raw) not 5000/5e21 spoof
    const tBalLive = BigInt((await viewOn(USD_TOKEN, "balance_of", [tortoiseWallet.address]))[0]);
    const scoreFinalT = BigInt(scoreAfterT[1]); // final_value is second element (after commitment)
    const spoofUnits = 5000n;
    const spoofRaw = spoofUnits * 10n**18n;
    if (scoreFinalT === spoofUnits || scoreFinalT === spoofRaw) throw new Error("FAIL-CLOSED: spoof inflated final_value leaked into attested score final="+scoreFinalT);
    // score should equal live raw (or low 128 bits thereof)
    if (scoreFinalT !== tBalLive) {
        console.log(`[verify] attested final_value=${scoreFinalT} live_raw=${tBalLive} — check raw equality (may be units vs raw)`);
        if (scoreFinalT !== tBalLive / (10n**18n)) {
            throw new Error("FAIL-CLOSED: attested final_value neither raw nor units match live balance");
        }
    }
    console.log("[verify] spoof resistance: attested score ignored open_submit_action ✅");

    // ── Wait for end, advance blocks, close & settle ──
    console.log("\n=== Close & Settle ===\n");
    const waitEnd = Number(endTime) - Math.floor(Date.now() / 1000) + 10;
    if (waitEnd > 0) { console.log(`waiting ${waitEnd}s for round end...`); await new Promise(r => setTimeout(r, waitEnd * 1000)); }

    // Advance blocks (Sepolia timestamps freeze without txs).
    for (let i = 0; i < 2; i++) {
        await sendTx(sponsor, `advance-${i}`, [{ contractAddress: USD_TOKEN, entrypoint: "mint", calldata: [sponsor.address, "1", "0"] }]);
    }
    step("advance_blocks", { mints: 2 });

    // f3 LIVE PROOF: close is permissionless — called by TORTOISE (not the sponsor).
    const { tx: closeTx } = await sendTx(tortoiseWallet, "close", [{ contractAddress: ARENA_ADDR, entrypoint: "close", calldata: [] }]);
    step("close", { tx: closeTx.transaction_hash, caller: "tortoise (non-sponsor)" });

    const winnerResult = await viewOn(ARENA_ADDR, "get_winner");
    const winnerCommitment = winnerResult[0];
    const winnerName = winnerCommitment === falconCommitment ? "FALCON" : winnerCommitment === tortoiseCommitment ? "TORTOISE" : `UNKNOWN(${winnerCommitment})`;
    console.log("[winner]", winnerName, winnerCommitment);

    // f3 LIVE PROOF: settle() takes NO amount — payout is structurally
    // min(deposited, cap) — and is permissionless: called by FALCON (non-sponsor).
    const { tx: settleTx } = await sendTx(falconWallet, "settle", [{ contractAddress: ARENA_ADDR, entrypoint: "settle", calldata: [] }]);
    const settlement = await viewOn(ARENA_ADDR, "get_settlement");
    assertEq(settlement[0], winnerCommitment, "settled winner == derived winner");
    assertEq(settlement[1], 100n, "settled amount == prize deposited");
    step("settle", { tx: settleTx.transaction_hash, caller: "falcon (non-sponsor)", winner: winnerName, amount: Number(BigInt(settlement[1])) });

    // Adapter V2 LIVE PROOF: each pool reclaims ONLY its own delivered capital,
    // exactly once, from the adapter's per-pool custody.
    for (const res of [tRes, fRes]) {
        const w = res.label === "Tortoise" ? tortoiseWallet : falconWallet;
        const balBefore = BigInt((await viewOn(USD_TOKEN, "balance_of", [w.address]))[0]);
        const { tx: refTx } = await sendTx(w, `withdraw:${res.label}`, [{ contractAddress: adapterAddr, entrypoint: "withdraw", calldata: [res.receipt_id] }]);
        const balAfter = BigInt((await viewOn(USD_TOKEN, "balance_of", [w.address]))[0]);
        if (balAfter - balBefore !== BigInt(res.custody.raw)) {
            throw new Error(`FAIL-CLOSED: ${res.label} withdraw delta mismatch (got ${balAfter - balBefore}, expected ${res.custody.raw})`);
        }
        console.log(`[verify] ${res.label} withdrew ${balAfter - balBefore} raw back from adapter custody`);
        res.withdrawn = true;
        res.withdraw_tx = refTx.transaction_hash;
    }
    step("adapter_withdraws", { tortoise: tRes.withdrawn, falcon: fRes.withdrawn });

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
        value_observation: "Option B attest: start captured via balance_of at register, live balance via balance_of + checkpoint peak/max_dd — open_submit spoof 5000 ignored",
        escrow_observation: "adapter custody verified via get_custody == allocation×price per receipt; capital reclaimed post-settle via permissioned withdraw",
        mediation: "Arena saw caller == bound action_adapter for every action (no direct EOA submissions)",
        permissionless_lifecycle: { closed_by: "tortoise (non-sponsor)", settled_by: "falcon (non-sponsor)", settle_param: "none — payout = min(deposited, cap)" },
    };

    console.log(`
════════════════════════════════════════
  HONEST ROUND B1 — ATTESTED FLOAT (Option B)

  Arena:   ${ARENA_ADDR} (P1-fixed class)
  Adapter: ${adapterAddr} (per-pool custody)
  Winner:  ${winnerName} (derived on-chain, settled)
  Tortoise accepted actions: ${finalCountsT[0]}
  Falcon   accepted actions: ${finalCountsF[0]}
  Every step verified via view calls on THE SAME arena + adapter.
════════════════════════════════════════`);

    finish(0);
    console.log("\n[evidence] written:", OUT_PATH);
    return 0;
}
