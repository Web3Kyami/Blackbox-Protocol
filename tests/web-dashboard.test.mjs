import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseScoreEntry,
  parseSettlementEntry,
  lookupStrategyLabel,
  sortLeaderboard,
  renderLeaderboardHtml,
  renderLiveEvidenceFeedHtml,
  renderDisconnectedState,
  detectWalletProvider,
  normalizeCommitment,
  buildRegisterStrategyCall,
  parseRegistrantResult,
  mapWalletError,
  SELECTORS,
  networkLabelFor,
  explorerTxUrlFor,
  renderReceiptTxRefHtml,
  buildCanonicalRulesJson,
  buildEvidenceExportPayload,
} from "../apps/web/src/dashboard-model.mjs";

describe("Frontend Dashboard Presentation & Behavior Contract", () => {
  const dummyStrat = { label: "Falcon", commitment: "0x46414c434f4e5f434f4d4d4954" };
  const tortoiseStrat = { label: "Tortoise", commitment: "0x544f52544f4953455f434f4d4d4954" };

  test("disconnected service renders 'Devnet Offline' status and instructions", () => {
    const offline = renderDisconnectedState();
    assert.match(offline.topbarText, /Devnet Offline/i);
    assert.strictEqual(offline.arenaAddress, "Offline");
    assert.strictEqual(offline.blockNumber, "#---");
    assert.match(offline.leaderboardHtml, /Devnet not running/i);
    assert.match(offline.leaderboardHtml, /npm run devnet:session/i);
    assert.match(offline.feedHtml, /No live session connected/i);
  });

  test("failed starknet_call RPC returns explicit error state and never fabricates 1000/0/eligible fallbacks", () => {
    // Simulated RPC error response
    const rpcErrorResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Contract call reverted: UNREGISTERED_STRATEGY" },
    };

    const parsed = parseScoreEntry(rpcErrorResponse, dummyStrat);
    assert.strictEqual(parsed.error, true);
    assert.strictEqual(parsed.errorReason, "Contract call reverted: UNREGISTERED_STRATEGY");
    assert.strictEqual(parsed.finalValue, undefined);
    assert.strictEqual(parsed.eligible, undefined);
    assert.strictEqual(parsed.scoreBps, undefined);

    // Malformed array result
    const badShapeResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: ["0x1", "0x2"], // too short
    };
    const badParsed = parseScoreEntry(badShapeResponse, dummyStrat);
    assert.strictEqual(badParsed.error, true);
    assert.strictEqual(badParsed.errorReason, "Invalid contract response shape");

    // Null/undefined response
    const nullParsed = parseScoreEntry(null, dummyStrat);
    assert.strictEqual(nullParsed.error, true);
  });

  test("failed starknet_call renders 'Score unavailable — contract read failed' in leaderboard HTML", () => {
    const scores = [
      {
        label: "Falcon",
        commitment: "0x46414c434f4e5f434f4d4d4954",
        error: true,
        errorReason: "RPC connection failed",
      },
    ];

    const html = renderLeaderboardHtml(scores);
    assert.match(html, /Score unavailable &mdash; contract read failed/i);
    assert.match(html, /RPC connection failed/);
    assert.doesNotMatch(html, /FINAL VAL/);
    assert.doesNotMatch(html, /1,000/);
    assert.doesNotMatch(html, /ELIGIBLE/);
  });

  test("valid contract score is parsed and rendered with deterministic tie-breaking", () => {
    // ScoreEntry struct: [commitment, final_value, return_bps, max_drawdown_bps, eligible, score_bps, registration_order]
    const tortoiseRpcResult = {
      jsonrpc: "2.0",
      id: 1,
      result: [
        "0x544f52544f4953455f434f4d4d4954",
        "0x460", // 1120
        "0x4b0", // 1200 bps
        "0x320", // 800 bps
        "0x1",   // eligible = true
        "0x190", // 400 bps
        "0x2",   // order = 2
      ],
    };

    const parsed = parseScoreEntry(tortoiseRpcResult, tortoiseStrat);
    assert.strictEqual(parsed.error, false);
    assert.strictEqual(parsed.finalValue, 1120);
    assert.strictEqual(parsed.returnBps, 1200);
    assert.strictEqual(parsed.maxDrawdownBps, 800);
    assert.strictEqual(parsed.eligible, true);
    assert.strictEqual(parsed.scoreBps, 400);
    assert.strictEqual(parsed.registrationOrder, 2);

    const html = renderLeaderboardHtml([parsed]);
    assert.match(html, /Tortoise/);
    assert.match(html, /1,120/);
    assert.match(html, /12%/);
    assert.match(html, /8%/);
    assert.match(html, /400 bps/);
    assert.match(html, /LEADER/);
  });

  test("empty live evidence renders 'No live action evidence in this session.' and excludes historical regression fixtures", () => {
    const emptyHtml = renderLiveEvidenceFeedHtml([]);
    assert.strictEqual(emptyHtml, '<div class="loading-placeholder">No live action evidence in this session.</div>');

    const nullHtml = renderLiveEvidenceFeedHtml(null);
    assert.strictEqual(nullHtml, '<div class="loading-placeholder">No live action evidence in this session.</div>');
  });

  test("current-session evidence renders only API-provided receipts", () => {
    const receipts = [
      {
        receiptId: "SESSION_ACT_001",
        strategyCommitment: "0x544f52544f4953455f434f4d4d4954",
        reasonCode: "ACTION_ACCEPTED",
        accepted: true,
        timestamp: "2026-08-21T18:00:00.000Z",
      },
    ];

    const html = renderLiveEvidenceFeedHtml(receipts);
    assert.match(html, /SESSION_ACT_001/);
    assert.match(html, /ACTION_ACCEPTED/);
    assert.match(html, /accepted/);
    assert.match(html, /Tortoise/);
    assert.doesNotMatch(html, /No live action evidence/);
  });

  test("parseSettlementEntry correctly parses settled, unsettled, and corrupted contract responses", () => {
    // 1. Settled state
    const settledRpcResult = {
      jsonrpc: "2.0",
      id: 1,
      result: ["0x544f52544f4953455f434f4d4d4954", "0x64"], // Tortoise, 100 units
    };
    const settled = parseSettlementEntry(settledRpcResult);
    assert.strictEqual(settled.settled, true);
    assert.strictEqual(settled.winner, "0x544f52544f4953455f434f4d4d4954");
    assert.strictEqual(settled.amountUnits, 100);

    // 2. Unsettled state
    const unsettledRpcResult = {
      jsonrpc: "2.0",
      id: 1,
      result: ["0x0", "0x0"],
    };
    const unsettled = parseSettlementEntry(unsettledRpcResult);
    assert.strictEqual(unsettled.settled, false);
    assert.strictEqual(unsettled.winner, "0x0");
    assert.strictEqual(unsettled.amountUnits, 0);

    // 3. Corrupt response
    const corrupt = parseSettlementEntry(null);
    assert.strictEqual(corrupt.settled, false);
    assert.strictEqual(corrupt.winner, "0x0");
  });

  test("lookupStrategyLabel maps known commitments and shortens unknown commitments", () => {
    assert.strictEqual(lookupStrategyLabel("0x544f52544f4953455f434f4d4d4954"), "Tortoise");
    assert.strictEqual(lookupStrategyLabel("0x46414c434f4e5f434f4d4d4954"), "Falcon");
    assert.strictEqual(lookupStrategyLabel("0x50554c53455f434f4d4d4954"), "Pulse");
    assert.match(lookupStrategyLabel("0x1234567890abcdef1234567890abcdef"), /\u2026/);
  });
});

describe("Operator Wallet Self-Service (Phase 5)", () => {
  test("detectWalletProvider identifies Ready, Braavos, generic, and absent wallets", () => {
    const argent = detectWalletProvider({ starknet: { isReady: true, request: () => {} } });
    assert.strictEqual(argent.available, true);
    assert.strictEqual(argent.name, "Ready (Argent)");

    const braavos = detectWalletProvider({
      starknet: { isBraavos: true, request: () => {} },
    });
    assert.strictEqual(braavos.available, true);
    assert.strictEqual(braavos.name, "Braavos");

    const generic = detectWalletProvider({ starknet: { request: () => {} } });
    assert.strictEqual(generic.available, true);
    assert.strictEqual(generic.name, "Starknet Wallet");

    const absent = detectWalletProvider({});
    assert.strictEqual(absent.available, false);
    assert.strictEqual(absent.provider, null);

    const brokenProvider = detectWalletProvider({ starknet: {} });
    assert.strictEqual(brokenProvider.available, false);
  });

  test("normalizeCommitment enforces 0x-prefix, hex-only, and felt252 bounds", () => {
    const good = normalizeCommitment("  0xDEADBEEF ");
    assert.strictEqual(good.ok, true);
    assert.strictEqual(good.value, "0xdeadbeef");

    assert.strictEqual(normalizeCommitment("").ok, false);
    assert.strictEqual(normalizeCommitment("   ").ok, false);
    assert.strictEqual(normalizeCommitment("DEADBEEF").ok, false);
    assert.strictEqual(normalizeCommitment("0xNOTheX").ok, false);

    const tooLong = normalizeCommitment(`0x${"f".repeat(63)}`);
    assert.strictEqual(tooLong.ok, false);
    assert.match(tooLong.error, /felt252/);

    const maxOk = normalizeCommitment(`0x${"a".repeat(62)}`);
    assert.strictEqual(maxOk.ok, true);
  });

  test("buildRegisterStrategyCall produces wallet-execute call with exact selector", () => {
    const call = buildRegisterStrategyCall(
      "0x1",
      "0x544f52544f4953455f434f4d4d4954",
    );
    assert.strictEqual(call.contractAddress, "0x1");
    assert.strictEqual(call.entrypoint, SELECTORS.register_strategy);
    assert.deepStrictEqual(call.calldata, ["0x544f52544f4953455f434f4d4d4954"]);

    assert.throws(() => buildRegisterStrategyCall("", "0x1"), /Arena address/);
    assert.throws(() => buildRegisterStrategyCall("0x1", "nothex"), /hexadecimal/);
  });

  test("parseRegistrantResult surfaces binding, zero, and error states without fabrication", () => {
    const ok = parseRegistrantResult({ result: ["0x823809"] });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.registrant, "0x823809");

    const zero = parseRegistrantResult({ result: ["0x0"] });
    assert.strictEqual(zero.ok, false);
    assert.match(zero.error, /No registrant/);

    const rpcError = parseRegistrantResult({
      error: { message: "Contract call reverted" },
    });
    assert.strictEqual(rpcError.ok, false);

    const malformed = parseRegistrantResult({ result: [] });
    assert.strictEqual(malformed.ok, false);
    assert.strictEqual(malformed.error, "Invalid contract response shape");
  });

  test("mapWalletError translates duplicate, closed-round, and rejection errors", () => {
    assert.match(
      mapWalletError(new Error("Execution failed: DUP_STRATEGY")),
      /already registered/i,
    );
    assert.match(
      mapWalletError(new Error("panicked with REG_CLOSED")),
      /Registration closed/i,
    );
    assert.match(mapWalletError(new Error("User rejected the transaction")), /rejected in wallet/i);
    assert.strictEqual(mapWalletError(undefined), "Unknown wallet error.");
  });

  test("register_strategy selector constant is a 32-byte felt hex string", () => {
    assert.match(SELECTORS.register_strategy, /^0x[0-9a-f]{64}$/);
  });
});

describe("Evidence Completion: labels, tx refs, canonical rules, exports (Phase 6)", () => {
  test("networkLabelFor maps every surface to exactly one authoritative label", () => {
    assert.strictEqual(networkLabelFor("case-study").text, "SIMULATED");
    assert.strictEqual(networkLabelFor("devnet").text, "LOCAL DEVNET");
    assert.strictEqual(networkLabelFor("sepolia").text, "SEPOLIA");
    assert.strictEqual(networkLabelFor("mainnet").text, "MAINNET");
    assert.strictEqual(networkLabelFor("anything-else").text, "OFFLINE");
  });

  test("explorerTxUrlFor links only real networks and never fabricates URLs", () => {
    const hash = "0xabc123";
    assert.strictEqual(
      explorerTxUrlFor("mainnet", "", hash),
      `https://voyager.online/tx/${hash}`,
    );
    assert.strictEqual(
      explorerTxUrlFor("sepolia", "", hash),
      `https://sepolia.voyager.online/tx/${hash}`,
    );
    // Local devnet has no public explorer: no fake link.
    assert.strictEqual(explorerTxUrlFor("devnet", "http://127.0.0.1:5050", hash), null);
    assert.strictEqual(explorerTxUrlFor("devnet", "", hash), null);
    // Invalid hashes yield null everywhere.
    assert.strictEqual(explorerTxUrlFor("mainnet", "", undefined), null);
    assert.strictEqual(explorerTxUrlFor("mainnet", "", "not-a-hash"), null);
  });

  test("receipt tx reference renders hash always, anchor only when explorer exists", () => {
    const receipt = { txHash: "0xdeadbeef", blockNumber: 42 };
    const devnetRef = renderReceiptTxRefHtml(receipt, "devnet", "");
    assert.match(devnetRef, /tx 0xdeadbeef|tx&nbsp;0xdeadbeef|title="0xdeadbeef"/);
    assert.match(devnetRef, /blk #42/);
    assert.ok(!devnetRef.includes("<a "), "devnet rows must not link to explorers");

    const sepoliaRef = renderReceiptTxRefHtml(receipt, "sepolia", "");
    assert.ok(sepoliaRef.includes("<a "));
    assert.match(sepoliaRef, /sepolia\.voyager\.online\/tx\/0xdeadbeef/);

    assert.strictEqual(renderReceiptTxRefHtml({}, "sepolia", ""), "");
  });

  test("buildCanonicalRulesJson sorts keys recursively and stringifies bigints", () => {
    const result = buildCanonicalRulesJson({
      endTime: 2000n,
      startTime: 1000n,
      nested: { b: BigInt(2), a: 1 },
      list: [3n, 1n],
      startingUnits: 1000n,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(
      result.json,
      '{"endTime":"2000","list":["3","1"],"nested":{"a":1,"b":"2"},"startTime":"1000","startingUnits":"1000"}',
    );

    const bad = buildCanonicalRulesJson(null);
    assert.strictEqual(bad.ok, false);
  });

  test("evidence export payload carries network label and exact receipts", () => {
    const receipts = [{ receiptId: "R1", accepted: true }];
    const payload = buildEvidenceExportPayload(receipts, {
      network: "devnet",
      arenaAddress: "0xarena",
      rulesCommitment: "0xrules",
    });
    assert.strictEqual(payload.network, "devnet");
    assert.strictEqual(payload.networkLabel, "LOCAL DEVNET");
    assert.strictEqual(payload.arenaAddress, "0xarena");
    assert.strictEqual(payload.rulesCommitment, "0xrules");
    assert.deepStrictEqual(payload.receipts, receipts);
    assert.ok(typeof payload.exportedAt === "string");
  });

  test("live evidence feed renders tx references when provided", () => {
    const html = renderLiveEvidenceFeedHtml(
      [
        {
          receiptId: "R1",
          accepted: true,
          reasonCode: "ACCEPTED",
          strategyCommitment: "0x544f52544f4953455f434f4d4d4954",
          timestamp: new Date().toISOString(),
          txHash: "0xfeedface",
        },
      ],
      "devnet",
      "",
    );
    assert.match(html, /tx 0xfeedface/);
  });
});

