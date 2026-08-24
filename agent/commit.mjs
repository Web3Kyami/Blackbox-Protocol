// Commit a strategy before round start: writes agent state with the commitment hash.
// The describe() text + params are stored LOCALLY (private); only the hash goes on-chain.
// Usage: node agent/commit.mjs --strategy tortoise --round .local/sepolia-round.json
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const STRATEGY = argOf("--strategy", "tortoise");
const ROUND_FILE = join(ROOT, argOf("--round", ".local/sepolia-round.json"));

// Import the strategy from runtime's registry (re-declare here to keep commit standalone)
const strategies = {
  tortoise: {
    label: "Tortoise",
    describe: () =>
      "Conservative compounder: act early in each half of the round with small allocations " +
      "(25-30% of current value), keep drawdown under 500bps, never chase losses. " +
      "Target steady positive returns over raw yield.",
    params: { allocFractionMin: 0.25, allocFractionMax: 0.30, maxDrawdownBps: 500, actionsPerHalf: 2 },
  },
  falcon: {
    label: "Falcon",
    describe: () =>
      "Aggressive momentum: one large mid-round push (max allowed allocation) betting on " +
      "a big single-tick gain. High variance — accepts drawdown risk for upside. " +
      "Exactly one action per round.",
    params: { triggerAtFraction: 0.45, allocFraction: 0.3499, targetGainBps: 1200 },
  },
};
const strategy = strategies[STRATEGY];
if (!strategy) { console.error(`Unknown strategy "${STRATEGY}"`); process.exit(1); }

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const describeText = strategy.describe();
const params = strategy.params;
const commitment = "0x" + createHash("sha256").update(canonicalize({ describe: describeText, params })).digest("hex");

const st = JSON.parse(readFileSync(ROUND_FILE, "utf8"));
const state = {
  strategy: STRATEGY,
  label: strategy.label,
  commitment,
  describeText,
  params,
  startTime: st.roundParams.startTime,
  endTime: st.roundParams.endTime,
  startingUnits: st.roundParams.startingUnits,
  arena: st.addresses.arena,
  committedAt: new Date().toISOString(),
};

const outFile = join(ROOT, ".local", `agent-${STRATEGY}.json`);
writeFileSync(outFile, JSON.stringify(state, null, 2));
console.log(`[${strategy.label}] committed: ${commitment}`);
console.log(`  state → ${outFile}`);
console.log(`  (register this commitment on-chain before round start)`);
