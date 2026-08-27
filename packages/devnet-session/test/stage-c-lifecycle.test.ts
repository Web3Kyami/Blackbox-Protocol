import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Contract, RpcProvider } from "starknet";
import {
  SessionServiceServer,
  type SanitizedSessionManifest,
  FALCON_COMMIT,
  TORTOISE_COMMIT,
  PULSE_COMMIT,
} from "../src/blackbox-session.js";
import { arenaRepoRoot, repoRoot } from "../src/utils.js";

describe("Stage C: Real Local-Devnet Lifecycle Controls & Authenticated API", () => {
  let server: SessionServiceServer | null = null;
  const SERVICE_PORT = 4176;
  const localDir = join(arenaRepoRoot(), ".local");

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("exercises full Stage C lifecycle: registration, shielded action, close, settlement, role checks, and zero secrets", async () => {
    server = new SessionServiceServer(SERVICE_PORT);
    await server.start();
    const session = server.getSession()!;
    expect(session).toBeDefined();

    const originHeaders = { Origin: "http://127.0.0.1:4173", "Content-Type": "application/json" };

    // ── 1. Initial State & Manifest Checks ────────────────────────────────────
    const initialManifestRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/session`, {
      headers: originHeaders,
    });
    expect(initialManifestRes.status).toBe(200);
    const initialManifest: SanitizedSessionManifest = await initialManifestRes.json();
    expect(initialManifest.status).toBe("active");
    expect(initialManifest.adapterLocked).toBe(true);
    expect(initialManifest.closed).toBe(false);
    expect(initialManifest.settled).toBe(false);

    // ── 2. Strategy Registration Controls ─────────────────────────────────────
    const customCommitment = "0x53545241544547595f54455354"; // 'STRATEGY_TEST'

    // 2a. Rejection: Non-sponsor role cannot register
    const badRoleRegRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/register`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ commitment: customCommitment, role: "alice" }),
    });
    expect(badRoleRegRes.status).toBe(403);
    const badRoleRegBody = await badRoleRegRes.json();
    expect(badRoleRegBody.error).toContain("Only sponsor");

    // 2b. Rejection: Invalid commitment format
    const badCommitRegRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/register`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ commitment: "invalid_not_hex", role: "sponsor" }),
    });
    expect(badCommitRegRes.status).toBe(400);

    // 2c. Success: Sponsor registers new strategy commitment
    const validRegRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/register`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ commitment: customCommitment, role: "sponsor" }),
    });
    expect(validRegRes.status).toBe(200);
    const validRegBody = await validRegRes.json();
    expect(validRegBody.success).toBe(true);
    expect(validRegBody.txHash).toMatch(/^0x[0-9a-fA-F]+/);
    expect(validRegBody.commitment).toBe(customCommitment);

    // 2d. Rejection: Duplicate strategy registration
    const dupRegRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/register`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ commitment: customCommitment, role: "sponsor" }),
    });
    expect(dupRegRes.status).toBe(400);
    const dupRegBody = await dupRegRes.json();
    expect(dupRegBody.error).toBeDefined();

    // ── 3. Shielded Action Submission Controls ────────────────────────────────
    // 3a. Rejection: Observer role (Bob) cannot submit actions
    const bobActionRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/submit-action`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({
        strategyCommitment: TORTOISE_COMMIT,
        allocationUnits: 350,
        portfolioValueBefore: 1000,
        portfolioValueAfter: 1120,
        drawdownBps: 800,
        role: "bob",
      }),
    });
    expect(bobActionRes.status).toBe(403);
    const bobActionBody = await bobActionRes.json();
    expect(bobActionBody.error).toContain("Bob is an observer");

    // 3b. Success: Alice submits valid Tortoise action through privacy pool
    const tortoiseReceiptId = "0x544f52544f4953455f4143545f31";
    const validActionRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/submit-action`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({
        strategyCommitment: TORTOISE_COMMIT,
        receiptId: tortoiseReceiptId,
        allocationUnits: 350,
        portfolioValueBefore: 1000,
        portfolioValueAfter: 1120,
        drawdownBps: 800,
        role: "alice",
      }),
    });
    expect(validActionRes.status).toBe(200);
    const validActionBody = await validActionRes.json();
    expect(validActionBody.success).toBe(true);
    expect(validActionBody.accepted).toBe(true);
    expect(validActionBody.reasonCode).toBe("ACCEPTED");
    expect(validActionBody.txHash).toMatch(/^0x[0-9a-fA-F]+/);

    // Verify Tortoise score on-chain
    const tortoiseScore: any = await session.arenaContract.call("get_score", [TORTOISE_COMMIT]);
    expect(tortoiseScore.final_value).toBe(1120n);
    expect(tortoiseScore.score_bps).toBe(400n);
    expect(tortoiseScore.eligible).toBe(true);

    // 3c. Oversized Falcon Action Rejection (700u > 35% of 1000)
    const falconActionRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/submit-action`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({
        strategyCommitment: FALCON_COMMIT,
        receiptId: "0x46414c434f4e5f4143545f424947",
        allocationUnits: 700,
        portfolioValueBefore: 1000,
        portfolioValueAfter: 1300,
        drawdownBps: 0,
        role: "alice",
      }),
    });
    expect(falconActionRes.status).toBe(200);
    const falconActionBody = await falconActionRes.json();
    expect(falconActionBody.accepted).toBe(false);
    expect(falconActionBody.reasonCode).toBe("ALLOCATION");

    // Falcon score on-chain remains unchanged (1000)
    const falconScore: any = await session.arenaContract.call("get_score", [FALCON_COMMIT]);
    expect(falconScore.final_value).toBe(1000n);
    expect(falconScore.return_bps).toBe(0n);

    // 3d. Duplicate Receipt Replay Rejection
    const replayActionRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/submit-action`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({
        strategyCommitment: TORTOISE_COMMIT,
        receiptId: tortoiseReceiptId, // Replay
        allocationUnits: 350,
        portfolioValueBefore: 1120,
        portfolioValueAfter: 1200,
        drawdownBps: 800,
        role: "alice",
      }),
    });
    expect(replayActionRes.status).toBe(200);
    const replayActionBody = await replayActionRes.json();
    expect(replayActionBody.accepted).toBe(false);
    expect(replayActionBody.reasonCode).toBe("DUPLICATE");

    // Evidence feed contains receipts
    const evidenceRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/evidence`, {
      headers: originHeaders,
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceData = await evidenceRes.json();
    expect(evidenceData.receipts.length).toBeGreaterThanOrEqual(3);

    // ── 4. Close Round Controls ───────────────────────────────────────────────
    // 4a. Rejection: Non-sponsor cannot close round
    const badRoleCloseRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/close`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ role: "alice" }),
    });
    expect(badRoleCloseRes.status).toBe(403);

    // 4b. Success: Sponsor closes round (advancing Devnet time)
    const closeRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/close`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ role: "sponsor", advanceTime: true }),
    });
    expect(closeRes.status).toBe(200);
    const closeBody = await closeRes.json();
    expect(closeBody.success).toBe(true);
    expect(closeBody.txHash).toMatch(/^0x[0-9a-fA-F]+/);
    expect(BigInt(closeBody.winner)).toBe(BigInt(TORTOISE_COMMIT));

    // Contract-verified winner check
    const onChainWinner: any = await session.arenaContract.call("get_winner");
    const winnerHex = typeof onChainWinner === "bigint" ? "0x" + onChainWinner.toString(16) : String(onChainWinner);
    expect(BigInt(winnerHex)).toBe(BigInt(TORTOISE_COMMIT));

    // 4c. Rejection: Closing an already closed round
    const dupCloseRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/close`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ role: "sponsor" }),
    });
    expect(dupCloseRes.status).toBe(400);

    // ── 5. Settle Round Controls ──────────────────────────────────────────────
    // 5a. Rejection: Non-sponsor cannot settle
    const badRoleSettleRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/settle`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ amountUnits: 100, role: "alice" }),
    });
    expect(badRoleSettleRes.status).toBe(403);

    // 5b. Rejection: Exceeding prize cap (150 > 100 cap)
    const overCapSettleRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/settle`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ amountUnits: 150, role: "sponsor" }),
    });
    expect(overCapSettleRes.status).toBe(400);

    // 5c. Success: Sponsor settles round with 100 prize units
    // Capture the winner's (sponsor-registered Tortoise) token balance before payout.
    // Starknet.js v10 requires the real token ABI artifact for calls.
    const rpc = new RpcProvider({ nodeUrl: session.rpcUrl });
    const tokenArtifact = JSON.parse(
      readFileSync(
        join(
          repoRoot(),
          "e2e/contracts/test-token/target/dev/test_token_TestToken.contract_class.json",
        ),
        "utf8",
      ),
    );
    const usdContract = new Contract({
      abi: tokenArtifact.abi,
      address: session.tokens.usdToken,
      providerOrAccount: rpc,
    });
    const readUsdBalance = async (): Promise<bigint> => {
      const raw: any = await usdContract.call("balance_of", [session.addresses.sponsorAddress]);
      return BigInt(raw);
    };
    const sponsorBalanceBefore = await readUsdBalance();

    const validSettleRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/settle`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ amountUnits: 100, role: "sponsor" }),
    });
    expect(validSettleRes.status).toBe(200);
    const validSettleBody = await validSettleRes.json();
    expect(validSettleBody.success).toBe(true);
    expect(BigInt(validSettleBody.winner)).toBe(BigInt(TORTOISE_COMMIT));
    expect(validSettleBody.amountUnits).toBe("100");

    // Contract-verified settlement check
    const settlementCall: any = await session.arenaContract.call("get_settlement");
    const sWinner = typeof settlementCall[0] === "bigint" ? "0x" + settlementCall[0].toString(16) : String(settlementCall[0]);
    const sAmount = typeof settlementCall[1] === "bigint" ? settlementCall[1] : BigInt(settlementCall[1]);
    expect(BigInt(sWinner)).toBe(BigInt(TORTOISE_COMMIT));
    expect(sAmount).toBe(100n);

    // P4.3: settlement actually pays the prize to the winner's registrant.
    const sponsorBalanceAfter = await readUsdBalance();
    expect(sponsorBalanceAfter - sponsorBalanceBefore).toBe(100n);

    // 5d. Rejection: Already settled
    const dupSettleRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/settle`, {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ amountUnits: 100, role: "sponsor" }),
    });
    expect(dupSettleRes.status).toBe(400);

    // ── 6. Final Manifest Verification ────────────────────────────────────────
    const finalManifestRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/session`, {
      headers: originHeaders,
    });
    expect(finalManifestRes.status).toBe(200);
    const finalManifest: SanitizedSessionManifest = await finalManifestRes.json();
    expect(finalManifest.closed).toBe(true);
    expect(finalManifest.settled).toBe(true);
    expect(BigInt(finalManifest.winner)).toBe(BigInt(TORTOISE_COMMIT));
    expect(finalManifest.settlementAmount).toBe(100);

    // P4.3 manifest fields are contract-verified values
    expect(finalManifest.prizeToken).toBeDefined();
    expect(BigInt(finalManifest.prizeToken)).toBe(BigInt(session.tokens.usdToken));
    expect(finalManifest.prizeDeposited).toBe(100);

    // ── 7. Origin Security & Secret Audit ─────────────────────────────────────
    const attackerRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/register`, {
      method: "POST",
      headers: { Origin: "http://malicious-site.com", "Content-Type": "application/json" },
      body: JSON.stringify({ commitment: "0x123", role: "sponsor" }),
    });
    expect(attackerRes.status).toBe(403);

    const secretKeywords = ["private", "privateKey", "priv_key", "secret", "viewingKey", "mnemonic"];
    const manifestStr = JSON.stringify(finalManifest);
    for (const kw of secretKeywords) {
      expect(manifestStr.toLowerCase()).not.toContain(kw.toLowerCase());
    }

    await server.stop();
    server = null;
  });
});
