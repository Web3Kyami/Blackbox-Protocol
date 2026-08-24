import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  SessionServiceServer,
  setupBlackboxSession,
  type SanitizedSessionManifest,
  FALCON_COMMIT,
  TORTOISE_COMMIT,
  PULSE_COMMIT,
  MOCK_TARGET,
  computeRulesCommitment,
} from "../src/blackbox-session.js";
import { arenaRepoRoot } from "../src/utils.js";

describe("Stage B: Read-Only Live Dashboard & Security Integrity", () => {
  let server: SessionServiceServer | null = null;
  const SERVICE_PORT = 4174;
  const localDir = join(arenaRepoRoot(), ".local");

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("proves contract-verified adapter lock, rules read, empty live evidence, origin security, and zero secrets", async () => {
    server = new SessionServiceServer(SERVICE_PORT);
    await server.start();
    const session = server.getSession()!;
    expect(session).toBeDefined();

    // 1. Contract-verified adapter lock
    const manifestRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/session`, {
      headers: { Origin: "http://127.0.0.1:4173" },
    });
    expect(manifestRes.status).toBe(200);
    const manifest: SanitizedSessionManifest = await manifestRes.json();

    // Assert adapter status comes from real contract value
    expect(manifest.configuredAdapterAddress).toBeDefined();
    expect(BigInt(manifest.configuredAdapterAddress)).toBe(BigInt(session.adapterAddress));
    expect(manifest.adapterLocked).toBe(true);

    // 2. Contract-verified rules commitment read
    expect(manifest.rulesCommitment).toBeDefined();

    // Recompute the expected SHA-256 digest from the session's actual parameters
    const expectedRulesCommitment = computeRulesCommitment({
      startTime: session.startTime,
      endTime: session.endTime,
      startingUnits: 1000n,
      maxAllocationBps: 3500,
      maxDrawdownBps: 2000,
      prizeCapUnits: 100n,
      allowedAssets: [session.tokens.usdToken],
      allowedTargets: [MOCK_TARGET],
    });
    expect(BigInt(manifest.rulesCommitment)).toBe(BigInt(expectedRulesCommitment));

    // Direct contract check via starknet.js Contract
    const onChainAdapter: any = await session.arenaContract.call("get_action_adapter");
    const onChainAdapterHex = typeof onChainAdapter === "bigint" ? "0x" + onChainAdapter.toString(16) : String(onChainAdapter);
    expect(BigInt(onChainAdapterHex)).toBe(BigInt(session.adapterAddress));

    const onChainRules: any = await session.arenaContract.call("rules_commitment");
    const onChainRulesHex = typeof onChainRules === "bigint" ? "0x" + onChainRules.toString(16) : String(onChainRules);
    expect(BigInt(onChainRulesHex)).toBe(BigInt(expectedRulesCommitment));

    // Contract-verified sponsor price for USD asset
    const PRICE_18 = BigInt("1000000000000000000");
    expect(manifest.assetPrices).toBeDefined();
    expect(manifest.assetPrices[session.tokens.usdToken]).toBeDefined();
    expect(BigInt(manifest.assetPrices[session.tokens.usdToken].price)).toBe(PRICE_18);
    expect(manifest.assetPrices[session.tokens.usdToken].timestamp).toBeGreaterThan(0);

    const onChainPrice: any = await session.arenaContract.call("get_price", [session.tokens.usdToken]);
    expect(BigInt(onChainPrice.toString())).toBe(PRICE_18);

    // Contract-verified operator binding: every default commitment maps to the
    // sponsor account that registered it, both in the manifest and on-chain.
    const FALCON_COMMIT = "0x46414c434f4e5f434f4d4d4954";
    const TORTOISE_COMMIT = "0x544f52544f4953455f434f4d4d4954";
    const PULSE_COMMIT = "0x50554c53455f434f4d4d4954";
    expect(manifest.strategyRegistrants).toBeDefined();
    for (const commitment of [FALCON_COMMIT, TORTOISE_COMMIT, PULSE_COMMIT]) {
      expect(manifest.strategyRegistrants[commitment]).toBeDefined();
      expect(BigInt(manifest.strategyRegistrants[commitment])).toBe(
        BigInt(session.addresses.sponsorAddress),
      );
      const onChainRegistrant: any = await session.arenaContract.call("get_registrant", [commitment]);
      const regHex =
        typeof onChainRegistrant === "bigint"
          ? "0x" + onChainRegistrant.toString(16)
          : String(onChainRegistrant);
      expect(BigInt(regHex)).toBe(BigInt(session.addresses.sponsorAddress));
    }

    // 3. Score RPC failure test: unregistered commitment returns registered=false, and error handling surfaces explicitly
    const unregisteredScore: any = await session.arenaContract.call("get_score", ["0x9999999999"]);
    expect(unregisteredScore.eligible).toBe(false);

    // 4. Live evidence feed is strictly empty on fresh session
    const evidenceRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/evidence`, {
      headers: { Origin: "http://127.0.0.1:4173" },
    });
    expect(evidenceRes.status).toBe(200);
    const evidenceData = await evidenceRes.json();
    expect(Array.isArray(evidenceData.receipts)).toBe(true);
    expect(evidenceData.receipts.length).toBe(0); // Proves no fabricated historical regression evidence in live feed

    // 5. Origin Security: Disallowed Origin receives HTTP 403 Forbidden
    const disallowedRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/session`, {
      headers: { Origin: "http://attacker-site.com" },
    });
    expect(disallowedRes.status).toBe(403);
    const errBody = await disallowedRes.json();
    expect(errBody.error).toContain("Forbidden");

    // 6. Strict Secret Exclusion: Zero private keys in memory manifests, API, or disk files
    const manifestStr = JSON.stringify(manifest);
    const secretKeywords = ["private", "privateKey", "priv_key", "secret", "viewingKey", "mnemonic"];
    for (const kw of secretKeywords) {
      expect(manifestStr.toLowerCase()).not.toContain(kw.toLowerCase());
    }

    const writtenManifest = readFileSync(join(localDir, "devnet-session.json"), "utf8");
    for (const kw of secretKeywords) {
      expect(writtenManifest.toLowerCase()).not.toContain(kw.toLowerCase());
    }

    // 7. Clean teardown removes PID
    const pidFile = join(localDir, "session.pid");
    expect(existsSync(pidFile)).toBe(true);

    await server.stop();
    server = null;
    expect(existsSync(pidFile)).toBe(false);
  });
});
