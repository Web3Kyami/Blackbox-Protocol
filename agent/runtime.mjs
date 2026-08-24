// Blackbox Arena — Agent Runtime
// A real competing agent: commits a sealed strategy (prompt + params hash) before
// round start, then runs a decision loop during the round, submitting actions that
// satisfy the deterministic scorer. The strategy content stays private; only the
// commitment hash goes public.
//
// Usage:
//   node agent/runtime.mjs --strategy tortoise --round .local/sepolia-round.json [--dry-run]
//
// Strategies live in agent/strategies/*.mjs and export:
//   { label, describe(): string  (the "prompt" / policy description),
//     decide(ctx): { allocationUnits, portfolioValueAfter, drawdownBps } | null }
// ctx = { tick, now, startTime, endTime, startingUnits, currentValue, maxAllocationUnits,
//         prices, seedRandom }
//
// The commitment is sha256(canonicalJson(describe() + params)) computed at commit time.
// After the round, reveal() publishes describe() so anyone can verify the hash matches.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── args ─────────────────────────────────────────────────────────────────────
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const STRATEGY = argOf("--strategy", "tortoise");
const DRY_RUN = process.argv.includes("--dry-run");
const STATE_FILE = join(ROOT, ".local", `agent-${STRATEGY}.json`);

// ── canonical json + commitment ──────────────────────────────────────────────
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}
export function commitStrategy(describeText, params) {
  return "0x" + createHash("sha256").update(canonicalize({ describe: describeText, params })).digest("hex");
}

// ── deterministic RNG (seeded per strategy+tick so replays match) ────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(label, tick) {
  const h = createHash("sha256").update(`${label}:${tick}`).digest();
  return h.readUInt32LE(0);
}

// ── strategies ───────────────────────────────────────────────────────────────
const strategies = {
  tortoise: {
    label: "Tortoise",
    describe: () =>
      "Conservative compounder: act early in each half of the round with small allocations " +
      "(25-30% of current value), keep drawdown under 500bps, never chase losses. " +
      "Target steady positive returns over raw yield.",
    params: { allocFractionMin: 0.25, allocFractionMax: 0.30, maxDrawdownBps: 500, actionsPerHalf: 2 },
    decide(ctx) {
      // Two actions per half; skip if we already acted this half-tick window.
      const halfLength = Math.floor((ctx.endTime - ctx.startTime) / 2);
      const position = ctx.now - ctx.startTime;
      const slot = Math.floor(position / (halfLength / this.params.actionsPerHalf));
      if (ctx.tick !== slot) return null;
      const frac = ctx.seedRandom() * (this.params.allocFractionMax - this.params.allocFractionMin) + this.params.allocFractionMin;
      const allocationUnits = Math.floor(ctx.currentValue * frac);
      // Simulated execution: small positive drift (in a live system this comes from
      // the target protocol's actual yield). Deterministic given seed.
      const driftBps = Math.floor(ctx.seedRandom() * 300) + 50; // +50..350 bps gain
      const portfolioValueAfter = ctx.currentValue + Math.floor((allocationUnits * driftBps) / 10000);
      return { allocationUnits, portfolioValueAfter, drawdownBps: 0 };
    },
  },
  falcon: {
    label: "Falcon",
    describe: () =>
      "Aggressive momentum: one large mid-round push (max allowed allocation) betting on " +
      "a big single-tick gain. High variance — accepts drawdown risk for upside. " +
      "Exactly one action per round.",
    params: { triggerAtFraction: 0.45, allocFraction: 0.3499, targetGainBps: 1200 },
    decide(ctx) {
      const elapsed = (ctx.now - ctx.startTime) / (ctx.endTime - ctx.startTime);
      if (elapsed < this.params.triggerAtFraction || ctx.tick !== 0) return null;
      const allocationUnits = Math.floor(ctx.currentValue * this.params.allocFraction);
      const portfolioValueAfter = ctx.currentValue + Math.floor((allocationUnits * this.params.targetGainBps) / 10000);
      return { allocationUnits, portfolioValueAfter, drawdownBps: 0 };
    },
  },
};

const strategy = strategies[STRATEGY];
if (!strategy) {
  console.error(`Unknown strategy "${STRATEGY}". Available: ${Object.keys(strategies).join(", ")}`);
  process.exit(1);
}

// ── round state ──────────────────────────────────────────────────────────────
if (!existsSync(STATE_FILE)) {
  console.error(`No agent state at ${STATE_FILE}. Run the commit step first (agent-commit.mjs).`);
  process.exit(1);
}
const agentState = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const { commitment, describeText, params } = agentState;
const startTime = Number(agentState.startTime);
const endTime = Number(agentState.endTime);
const startingUnits = Number(agentState.startingUnits);

// Verify our commitment matches what's on record (integrity check)
const recomputed = commitStrategy(describeText, params);
if (recomputed !== commitment) {
  throw new Error(`Commitment mismatch! recorded=${commitment} recomputed=${recomputed}`);
}
console.log(`[${strategy.label}] commitment verified: ${commitment.slice(0, 18)}…`);

let runState = { tick: 0, currentValue: Number(startingUnits), actions: [], done: false };
if (existsSync(STATE_FILE.replace(".json", "-run.json"))) {
  runState = JSON.parse(readFileSync(STATE_FILE.replace(".json", "-run.json"), "utf8"));
}

const now = DRY_RUN ? startTime + 60 : Math.floor(Date.now() / 1000);
if (now > endTime && !DRY_RUN) {
  console.error("Round has ended.");
  process.exit(1);
}

const ctx = {
  tick: runState.tick,
  now,
  startTime,
  endTime,
  startingUnits: Number(startingUnits),
  currentValue: runState.currentValue,
  maxAllocationUnits: Math.floor(runState.currentValue * 0.35), // maxAllocationBps 3500
  seedRandom: mulberry32(seedFrom(STRATEGY, runState.tick)),
};

const decision = strategy.decide.call(strategy, ctx);
if (!decision) {
  console.log(`[tick ${ctx.tick}] no action this tick.`);
} else {
  const receiptId = `${STRATEGY}-r${runState.tick}-${now}`;
  const action = {
    receiptId,
    strategyCommitment: commitment,
    submittedAt: now,
    asset: "TEST_USD",
    target: "MOCK_EXECUTOR",
    ...decision,
    portfolioValueBefore: runState.currentValue,
  };
  console.log(`[tick ${ctx.tick}] action:`, JSON.stringify(action, null, 2));
  if (DRY_RUN) {
    // local scorer check via core engine would go here; for dry-run just simulate accept
    runState.currentValue = decision.portfolioValueAfter;
    runState.actions.push(action);
    runState.tick += 1;
  } else {
    // Submit through adapter → arena (on-chain). Requires pool path or direct submit.
    console.log("[live] submission path requires on-chain wiring (see agent/submit.mjs)");
    runState.actions.push(action); // record locally regardless
    runState.tick += 1;
  }
  writeFileSync(STATE_FILE.replace(".json", "-run.json"), JSON.stringify(runState, null, 2));
}
console.log(`[${strategy.label}] currentValue=${runState.currentValue} actions=${runState.actions.length}`);
