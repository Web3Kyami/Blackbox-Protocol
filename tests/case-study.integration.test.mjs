import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runCaseStudy } from "../fixtures/strategies/case-study.mjs";

test("fixture result is calculated, documented, and not hard-coded in the UI", async () => {
  const { arena, leaderboard } = runCaseStudy();
  const snapshot = arena.publicSnapshot();
  assert.equal(leaderboard[0].label, "Tortoise");
  assert.equal(snapshot.leaderboard[0].scoreBps, 400);
  const app = await readFile(new URL("../apps/web/src/app.mjs", import.meta.url), "utf8");
  assert.equal(app.includes('winner = "Tortoise"'), false);
  assert.equal(app.includes("scoreBps: 400"), false);
});

