import assert from "node:assert/strict";
import test from "node:test";
import { Arena, RejectionCode, calculateReturnBps, commitRules } from "../src/arena.mjs";
import { END_TIME, START_TIME, buildCaseStudyArena, caseStudyRules, commitments, runCaseStudy } from "../../../fixtures/strategies/case-study.mjs";

const action = (overrides = {}) => ({
  receiptId: "receipt-1",
  strategyCommitment: commitments.Falcon,
  submittedAt: START_TIME + 1,
  asset: "TEST_USD",
  target: "MOCK_EXECUTOR",
  allocationUnits: 100,
  portfolioValueBefore: 1_000,
  portfolioValueAfter: 1_010,
  drawdownBps: 100,
  ...overrides,
});

test("creates a valid arena with a stable rules commitment", () => {
  const arena = buildCaseStudyArena();
  assert.match(arena.rulesCommitment, /^0x[0-9a-f]{64}$/);
  assert.equal(arena.assertRulesCommitment(), true);
  assert.equal(commitRules(arena.rules), arena.rulesCommitment);
});

test("rejects invalid start/end times", () => {
  assert.throws(() => new Arena({ id: "bad", sponsor: "amara", createdAt: 1, rules: { ...caseStudyRules, startTime: 10, endTime: 10 } }), /start time must be before end time/);
});

test("rules cannot be changed after commitment", () => {
  const arena = buildCaseStudyArena();
  assert.throws(() => { arena.rules.maxAllocationBps = 9_000; }, TypeError);
  assert.throws(() => arena.rules.allowedAssets.push("EVIL"), TypeError);
  assert.equal(arena.assertRulesCommitment(), true);
});

test("registers a strategy and rejects duplicate registration", () => {
  const arena = new Arena({ id: "registration", sponsor: "amara", createdAt: START_TIME - 10, rules: caseStudyRules });
  arena.registerStrategy({ label: "Falcon", commitment: commitments.Falcon, registeredAt: START_TIME - 2 });
  assert.throws(() => arena.registerStrategy({ label: "Falcon clone", commitment: commitments.Falcon, registeredAt: START_TIME - 1 }), /duplicate strategy registration/);
});

test("rejects entry after start", () => {
  const arena = new Arena({ id: "late", sponsor: "amara", createdAt: START_TIME - 10, rules: caseStudyRules });
  assert.throws(() => arena.registerStrategy({ label: "Late", commitment: commitments.Falcon, registeredAt: START_TIME }), /registration is closed/);
});

test("rejects unregistered strategies", () => {
  const arena = buildCaseStudyArena();
  const result = arena.submitAction(action({ strategyCommitment: `0x${"f".repeat(64)}` }));
  assert.deepEqual([result.accepted, result.reason], [false, RejectionCode.UNREGISTERED_STRATEGY]);
});

test("rejects actions before start and after close", () => {
  const before = buildCaseStudyArena().submitAction(action({ submittedAt: START_TIME - 1 }));
  assert.equal(before.reason, RejectionCode.ACTION_BEFORE_START);
  const arena = buildCaseStudyArena();
  const after = arena.submitAction(action({ submittedAt: END_TIME + 1 }));
  assert.equal(after.reason, RejectionCode.ACTION_AFTER_CLOSE);
});

test("rejects unsupported assets and unauthorized targets", () => {
  const unsupported = buildCaseStudyArena().submitAction(action({ asset: "SCAM" }));
  const unauthorized = buildCaseStudyArena().submitAction(action({ target: "ROGUE_EXECUTOR" }));
  assert.equal(unsupported.reason, RejectionCode.UNSUPPORTED_ASSET);
  assert.equal(unauthorized.reason, RejectionCode.UNAUTHORIZED_TARGET);
});

test("rejects allocation over 35 percent", () => {
  const result = buildCaseStudyArena().submitAction(action({ allocationUnits: 351 }));
  assert.deepEqual([result.accepted, result.reason], [false, RejectionCode.ALLOCATION_EXCEEDED]);
});

test("accepts allocation exactly at 35 percent", () => {
  assert.equal(buildCaseStudyArena().submitAction(action({ allocationUnits: 350 })).accepted, true);
});

test("rejects duplicate receipt replay", () => {
  const arena = buildCaseStudyArena();
  assert.equal(arena.submitAction(action()).accepted, true);
  assert.equal(arena.submitAction(action()).reason, RejectionCode.DUPLICATE_RECEIPT);
});

test("calculates integer return basis points with truncation", () => {
  assert.equal(calculateReturnBps(1_000, 1_120), 1_200);
  assert.equal(calculateReturnBps(3, 4), 3_333);
  assert.equal(calculateReturnBps(3, 2), -3_333);
});

test("tracks maximum drawdown rather than the latest drawdown", () => {
  const arena = buildCaseStudyArena();
  arena.submitAction(action({ receiptId: "peak-dd", portfolioValueAfter: 990, drawdownBps: 900 }));
  arena.submitAction(action({ receiptId: "recovered", portfolioValueBefore: 990, portfolioValueAfter: 1_050, drawdownBps: 300 }));
  arena.close({ caller: "amara", closedAt: END_TIME });
  assert.equal(arena.leaderboard().find((entry) => entry.label === "Falcon").maxDrawdownBps, 900);
});

test("Falcon oversized action is rejected and excluded from final value", () => {
  const { actions, leaderboard } = runCaseStudy();
  assert.equal(actions.falconOversized.reason, RejectionCode.ALLOCATION_EXCEEDED);
  assert.equal(leaderboard.find((entry) => entry.label === "Falcon").finalValue, 1_010);
});

test("Pulse is disqualified despite highest final value", () => {
  const pulse = runCaseStudy().leaderboard.find((entry) => entry.label === "Pulse");
  assert.deepEqual([pulse.finalValue, pulse.maxDrawdownBps, pulse.eligible, pulse.scoreBps], [1_180, 2_500, false, null]);
});

test("Tortoise wins with a derived 400 bps score", () => {
  const [winner] = runCaseStudy().leaderboard;
  assert.deepEqual([winner.label, winner.returnBps, winner.maxDrawdownBps, winner.scoreBps], ["Tortoise", 1_200, 800, 400]);
});

test("tie-breaker prefers lower drawdown then earlier registration", () => {
  const arena = buildCaseStudyArena();
  arena.submitAction(action({ receiptId: "f", portfolioValueAfter: 1_100, drawdownBps: 500 }));
  arena.submitAction(action({ receiptId: "t", strategyCommitment: commitments.Tortoise, portfolioValueAfter: 1_090, drawdownBps: 400 }));
  arena.submitAction(action({ receiptId: "p", strategyCommitment: commitments.Pulse, portfolioValueAfter: 1_090, drawdownBps: 400 }));
  const leaderboard = arena.close({ caller: "amara", closedAt: END_TIME });
  assert.deepEqual(leaderboard.map((entry) => entry.label), ["Tortoise", "Pulse", "Falcon"]);
});

test("payout cannot exceed cap and only sponsor may close or settle", () => {
  const arena = runCaseStudy().arena;
  assert.throws(() => arena.settle({ caller: "attacker", amountUnits: 50, settledAt: END_TIME + 1 }), /only sponsor/);
  assert.throws(() => arena.settle({ caller: "amara", amountUnits: 101, settledAt: END_TIME + 1 }), /exceeds prize cap/);
  assert.deepEqual(arena.settle({ caller: "amara", amountUnits: 100, settledAt: END_TIME + 1 }).amountUnits, 100);
  const open = buildCaseStudyArena();
  assert.throws(() => open.close({ caller: "attacker", closedAt: END_TIME }), /only sponsor/);
});

test("public snapshot contains evidence but no strategy implementation secrets", () => {
  const snapshot = runCaseStudy().arena.publicSnapshot();
  const serialized = JSON.stringify(snapshot).toLowerCase();
  for (const forbidden of ["prompt", "signal weight", "private key", "seed phrase", "model configuration"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

