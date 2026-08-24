import { createHash } from "node:crypto";
import { Arena } from "../../packages/core/src/arena.mjs";

const commitment = (versionLabel) => `0x${createHash("sha256").update(versionLabel).digest("hex")}`;

export const START_TIME = 2_000_000_000;
export const END_TIME = START_TIME + 3_600;

export const commitments = Object.freeze({
  Falcon: commitment("blackbox:falcon:sealed:v1"),
  Tortoise: commitment("blackbox:tortoise:sealed:v1"),
  Pulse: commitment("blackbox:pulse:sealed:v1"),
});

export const caseStudyRules = Object.freeze({
  startTime: START_TIME,
  endTime: END_TIME,
  startingUnits: 1_000,
  maxAllocationBps: 3_500,
  maxDrawdownBps: 2_000,
  prizeCapUnits: 100,
  allowedAssets: ["TEST_USD"],
  allowedTargets: ["MOCK_EXECUTOR"],
});

export function buildCaseStudyArena() {
  const arena = new Arena({ id: "amara-qualification-001", sponsor: "amara", rules: caseStudyRules, createdAt: START_TIME - 1_000 });
  arena.registerStrategy({ label: "Falcon", commitment: commitments.Falcon, registeredAt: START_TIME - 300 });
  arena.registerStrategy({ label: "Tortoise", commitment: commitments.Tortoise, registeredAt: START_TIME - 200 });
  arena.registerStrategy({ label: "Pulse", commitment: commitments.Pulse, registeredAt: START_TIME - 100 });
  return arena;
}

export function runCaseStudy() {
  const arena = buildCaseStudyArena();
  const base = {
    submittedAt: START_TIME + 60,
    asset: "TEST_USD",
    target: "MOCK_EXECUTOR",
  };

  const falconOversized = arena.submitAction({
    ...base,
    receiptId: "falcon-oversized-001",
    strategyCommitment: commitments.Falcon,
    allocationUnits: 700,
    portfolioValueBefore: 1_000,
    portfolioValueAfter: 1_300,
    drawdownBps: 0,
  });
  const falconValid = arena.submitAction({
    ...base,
    submittedAt: START_TIME + 120,
    receiptId: "falcon-valid-002",
    strategyCommitment: commitments.Falcon,
    allocationUnits: 300,
    portfolioValueBefore: 1_000,
    portfolioValueAfter: 1_010,
    drawdownBps: 200,
  });
  const tortoiseValid = arena.submitAction({
    ...base,
    submittedAt: START_TIME + 180,
    receiptId: "tortoise-valid-001",
    strategyCommitment: commitments.Tortoise,
    allocationUnits: 350,
    portfolioValueBefore: 1_000,
    portfolioValueAfter: 1_120,
    drawdownBps: 800,
  });
  const pulseValid = arena.submitAction({
    ...base,
    submittedAt: START_TIME + 240,
    receiptId: "pulse-valid-001",
    strategyCommitment: commitments.Pulse,
    allocationUnits: 350,
    portfolioValueBefore: 1_000,
    portfolioValueAfter: 1_180,
    drawdownBps: 2_500,
  });

  const leaderboard = arena.close({ caller: "amara", closedAt: END_TIME });
  return { arena, leaderboard, actions: { falconOversized, falconValid, tortoiseValid, pulseValid } };
}

