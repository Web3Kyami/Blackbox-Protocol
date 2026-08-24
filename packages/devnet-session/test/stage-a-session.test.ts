import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  SessionServiceServer,
  setupBlackboxSession,
  type SanitizedSessionManifest,
} from "../src/blackbox-session.js";
import { arenaRepoRoot } from "../src/utils.js";

describe("Stage A: Reusable Devnet Session & Localhost Service", () => {
  let server: SessionServiceServer | null = null;
  const SERVICE_PORT = 4174;
  const localDir = join(arenaRepoRoot(), ".local");

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("starts localhost session service, serves health, and exposes sanitized manifest with zero secrets", async () => {
    server = new SessionServiceServer(SERVICE_PORT);
    await server.start();

    // 1. Check /api/health
    const healthRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/health`);
    expect(healthRes.status).toBe(200);
    const healthData = await healthRes.json();
    expect(healthData.status).toBe("ok");
    expect(healthData.devnetRunning).toBe(true);
    expect(healthData.indexerRunning).toBe(true);

    // 2. Check /api/devnet/session
    const sessionRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/session`);
    expect(sessionRes.status).toBe(200);
    const manifest: SanitizedSessionManifest = await sessionRes.json();

    expect(manifest.status).toBe("active");
    expect(manifest.rpcUrl).toContain("http://127.0.0.1:");
    expect(manifest.addresses.arenaAddress).toMatch(/^0x[0-9a-fA-F]+/);
    expect(manifest.addresses.adapterAddress).toMatch(/^0x[0-9a-fA-F]+/);
    expect(manifest.addresses.privacyPoolAddress).toMatch(/^0x[0-9a-fA-F]+/);
    expect(manifest.addresses.usdTokenAddress).toMatch(/^0x[0-9a-fA-F]+/);
    expect(manifest.addresses.sponsorAddress).toMatch(/^0x[0-9a-fA-F]+/);
    expect(manifest.addresses.aliceAddress).toMatch(/^0x[0-9a-fA-F]+/);
    expect(manifest.adapterLocked).toBe(true);

    // 3. Strict Secret Exclusion Audit on manifest payload and written file
    const manifestStr = JSON.stringify(manifest);
    const secretKeywords = ["private", "privateKey", "priv_key", "secret", "viewingKey", "mnemonic"];
    for (const kw of secretKeywords) {
      expect(manifestStr.toLowerCase()).not.toContain(kw.toLowerCase());
    }

    const writtenManifestPath = join(localDir, "devnet-session.json");
    expect(existsSync(writtenManifestPath)).toBe(true);
    const fileContent = readFileSync(writtenManifestPath, "utf8");
    for (const kw of secretKeywords) {
      expect(fileContent.toLowerCase()).not.toContain(kw.toLowerCase());
    }

    // 4. Verify static ABI endpoint
    const arenaAbiRes = await fetch(`http://127.0.0.1:${SERVICE_PORT}/api/devnet/abi/arena`);
    expect(arenaAbiRes.status).toBe(200);
    const arenaAbi = await arenaAbiRes.json();
    expect(Array.isArray(arenaAbi.abi)).toBe(true);
    const hasGetScore = arenaAbi.abi.some(
      (entry: any) =>
        entry.type === "interface" &&
        entry.items?.some((fn: any) => fn.name === "get_score"),
    );
    expect(hasGetScore).toBe(true);

    // 5. Test PID file existence and cleanup
    const pidFile = join(localDir, "session.pid");
    expect(existsSync(pidFile)).toBe(true);

    await server.stop();
    server = null;
    expect(existsSync(pidFile)).toBe(false);
  });
});
