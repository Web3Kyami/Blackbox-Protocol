// Declare the NEW Arena class (escrowed actions + permissionless lifecycle) on Sepolia.
// Sponsor wallet pays. Fee path per sepolia-deploy-round.mjs D016d:
// SDK estimateDeclareFee resourceBounds verbatim amounts, prices as BigInt (+mult%).
// NOTE: hex STRINGS in bound prices corrupt the tx hash (poseidon 'invalid bigint').
//
// Knobs (Sepolia validator quirk: big sierra declares sometimes rejected with
// "Resources bounds exceed balance" even when Σ(amount×price) << balance):
//   --mult N     price multiplier percent (default 105)
//   --l2div N    divide l2_gas.max_amount by N (default 1)
//   --l2amt HEX  override l2_gas.max_amount outright
import { readFileSync } from "node:fs";
const ROOT = "/root/projects/BlackBox Arena";
const { Account, RpcProvider } = await import(`${ROOT}/_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js`);

let ALCHEMY_KEY = "";
for (const l of readFileSync(`${ROOT}/.env.local`, "utf8").split("\n")) {
    if (l.startsWith("ALCHEMY_API_KEY=")) ALCHEMY_KEY = l.split("=").slice(1).join("=").trim();
}
const provider = new RpcProvider({ nodeUrl: `https://starknet-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}` });
const env = Object.fromEntries(
    readFileSync(`${ROOT}/.local/burner-c.env`, "utf8").split(/\r?\n/)
        .filter(l => l.includes("=") && !l.startsWith("#"))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sponsor = new Account({ provider, address: env.STARKNET_ACCOUNT_ADDRESS, signer: env.STARKNET_PRIVATE_KEY });

const sierra = JSON.parse(readFileSync(`${ROOT}/contracts/target/dev/blackbox_arena_contracts_Arena.contract_class.json`, "utf8"));
const casm = JSON.parse(readFileSync(`${ROOT}/contracts/target/dev/blackbox_arena_contracts_Arena.compiled_contract_class.json`, "utf8"));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter(p => p.length === 2));
const MULT = BigInt(Math.round(Number(args.mult ?? "105")));
const L2DIV = BigInt(args.l2div ?? "1");
const L2AMT = args.l2amt ?? null;
const TIP = "0x" + (BigInt(args.tip ?? "0") * 10n ** 12n).toString(16);

console.log(`[declare] Arena class (escrowed + permissionless lifecycle)…`);
console.log(`[declare] knobs: mult=${MULT}/100 l2div=${L2DIV}${L2AMT ? ` l2amt=${L2AMT}` : ""} tip=${args.tip ?? "0"}x1e12`);
const est = await sponsor.estimateDeclareFee({ contract: sierra, casm }, { tip: TIP });
const rb = est.resourceBounds;
const bounds = {
    l1_gas: { max_amount: BigInt(rb.l1_gas.max_amount), max_price_per_unit: (BigInt(rb.l1_gas.max_price_per_unit) * MULT) / 100n },
    l1_data_gas: { max_amount: BigInt(rb.l1_data_gas.max_amount), max_price_per_unit: (BigInt(rb.l1_data_gas.max_price_per_unit) * MULT) / 100n },
    l2_gas: { max_amount: L2AMT ? BigInt(L2AMT) : (BigInt(rb.l2_gas.max_amount) / L2DIV), max_price_per_unit: (BigInt(rb.l2_gas.max_price_per_unit) * MULT) / 100n },
};
const estStrk = Number(BigInt(est.overall_fee)) / 1e18;
console.log(`[declare] estimated ~${estStrk.toFixed(4)} STRK — submitting`);

let res;
try {
    res = await sponsor.declare({ contract: sierra, casm }, { resourceBounds: bounds, tip: TIP });
} catch (err) {
    const blob = `${err?.message ?? ""} ${JSON.stringify(err?.data ?? "")}`;
    if (/is already declared/i.test(blob)) {
        const m = /Class with hash (0x[0-9a-fA-F]+)/.exec(blob);
        console.log(`[declare] already declared: ${m?.[1] ?? "?"}`);
        process.exit(0);
    }
    // Full message echoes the whole sierra program — dump to file, print short.
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/declare-err.txt", String(err?.message ?? ""), "utf8");
    console.log(`[declare] RPC REJECTED code=${err?.code ?? "?"} — full message → /tmp/declare-err.txt`);
    process.exit(1);
}
const rcpt = await provider.waitForTransaction(res.transaction_hash);
if (rcpt.execution_status !== "SUCCEEDED") {
    console.log(`[declare] FAILED: ${rcpt.execution_status} ${String(rcpt.revert_reason ?? "").slice(0, 200)}`);
    process.exit(1);
}
console.log(`[declare] ✅ class_hash=${res.class_hash}`);
console.log(`[declare] tx=${res.transaction_hash}`);
