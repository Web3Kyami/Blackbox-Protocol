import assert from "node:assert/strict";
import { runCaseStudy } from "../fixtures/strategies/case-study.mjs";

const { arena, leaderboard } = runCaseStudy();
const snapshot = arena.publicSnapshot();
assert.equal(typeof snapshot.id, "string");
assert.equal(typeof snapshot.rulesCommitment, "string");
assert.ok(Array.isArray(snapshot.evidence));
assert.ok(Array.isArray(leaderboard));
for (const row of leaderboard) {
  assert.equal(typeof row.label, "string");
  assert.equal(typeof row.finalValue, "number");
  assert.equal(typeof row.returnBps, "number");
  assert.equal(typeof row.eligible, "boolean");
}
console.log("Runtime public-state type contract passed.");

