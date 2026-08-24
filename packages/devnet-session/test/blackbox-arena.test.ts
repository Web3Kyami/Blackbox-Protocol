import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { Contract, type Account, type RpcProvider } from "starknet";
import { Devnet } from "@starkware-libs/starknet-privacy-sdk/testing";
import { Open } from "@starkware-libs/starknet-privacy-sdk";
import { createE2eTestEnv, type E2eTestEnv } from "../src/harness.js";
import { deployTestTokens, type TokenAddresses } from "../src/vesu-setup.js";
import {
  declareClass,
  deployContract,
  executeAndWait,
  u256Calldata,
  arenaRepoRoot,
} from "../src/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DEV_DIR = join(arenaRepoRoot(), "contracts/target/dev");

import {
  setupBlackboxSession,
  type BlackboxSession,
  FALCON_COMMIT,
  TORTOISE_COMMIT,
  PULSE_COMMIT,
  MOCK_TARGET,
} from "../src/blackbox-session.js";

describe("Blackbox Arena on Devnet", () => {
  let session: BlackboxSession;
  let devnet: Devnet;
  let env: E2eTestEnv;
  let tokens: TokenAddresses;
  let arenaAddress: string;
  let adapterAddress: string;

  beforeAll(async () => {
    session = await setupBlackboxSession();
    devnet = session.devnet;
    env = session.env;
    tokens = session.tokens;
    arenaAddress = session.arenaAddress;
    adapterAddress = session.adapterAddress;
    console.log("[PROGRESS] Arena deployed at", arenaAddress);
    console.log("[PROGRESS] ArenaAdapter deployed at", adapterAddress);
    console.log("[PROGRESS] Adapter locked via set_action_adapter");
  });

  afterAll(async () => {
    await session?.shutdown();
  });

  it("shielded note -> privacy pool privacy_invoke -> ArenaAdapter -> Arena end-to-end", async () => {
    const { env: de, transfers } = env;
    const ONE_TOKEN = 10n ** 18n;
    const depositAmount = 1000n * ONE_TOKEN;
    const actionAmount = 350n * ONE_TOKEN;

    // 1. Mint USD to Alice and approve privacy pool
    const mintTx = await de.admin.execute({
      contractAddress: tokens.usdToken,
      entrypoint: "mint",
      calldata: [de.alice.address, ...u256Calldata(depositAmount)],
    });
    await de.provider.waitForTransaction(mintTx.transaction_hash);

    const approveTx = await de.alice.execute({
      contractAddress: tokens.usdToken,
      entrypoint: "approve",
      calldata: [de.privacy.address, ...u256Calldata(depositAmount)],
    });
    await de.provider.waitForTransaction(approveTx.transaction_hash);

    // 2. Deposit USD into privacy pool to create shielded note
    const { callAndProof: depositCall } = await transfers.alice
      .build({
        autoRegister: true,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokens.usdToken, (token) =>
        token.deposit({ amount: depositAmount }),
      )
      .surplusTo(de.alice.address)
      .execute();
    await devnet.executeOutside(depositCall);
    await env.indexer.waitForBlock(devnet.url);

    // Advance Devnet time so the Arena round is active
    await fetch(devnet.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "devnet_setTime",
        params: { time: Number(session.startTime) + 2 },
      }),
    });
    await fetch(devnet.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "devnet_createBlock",
      }),
    });

    // 3. Submit valid Tortoise action through privacy pool invoke
    const tortoiseReceiptId = "0x544f52544f4953455f4f4b"; // 'TORTOISE_OK'
    const { callAndProof: tortoiseCall } = await transfers.alice
      .build({
        autoSetup: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokens.usdToken)
      .withdraw({ recipient: adapterAddress, amount: actionAmount })
      .surplusTo(de.alice.address, false)
      .with(tokens.usdToken)
      .transfer({
        recipient: de.alice.address,
        amount: Open,
      })
      .done()
      .invoke((args) => {
        const openNote = args.openNotes[0];
        if (!openNote) {
          throw new Error("Expected one open note for Tortoise action");
        }
        return {
          contractAddress: adapterAddress,
          calldata: [
            tokens.usdToken,
            de.privacy.address,
            openNote.noteId,
            tortoiseReceiptId,
            TORTOISE_COMMIT,
            tokens.usdToken,
            MOCK_TARGET,
            350n, // allocation_units
            1000n, // portfolio_value_before
            1120n, // portfolio_value_after
            800n, // drawdown_bps
          ],
        };
      })
      .execute();
    await devnet.executeOutside(tortoiseCall);
    await env.indexer.waitForBlock(devnet.url);
    console.log("[PROGRESS] Tortoise privacy_invoke executed and block indexed");

    // 4. Verify Tortoise score on Arena contract
    // Load the real Arena ABI from the compiled artifact — required for
    // Starknet.js v10 which uses ContractOptions: { abi, address, providerOrAccount }.
    // A hand-written partial ABI breaks getAbiVersion / createAbiParser in v10.
    const arenaArtifact = JSON.parse(
      readFileSync(
        join(CONTRACTS_DEV_DIR, "blackbox_arena_contracts_Arena.contract_class.json"),
        "utf8",
      ),
    );
    const arenaContract = new Contract({
      abi: arenaArtifact.abi,
      address: arenaAddress,
      providerOrAccount: de.provider,
    });

    const tortoiseScore: any = await arenaContract.call("get_score", [
      TORTOISE_COMMIT,
    ]);
    console.log("[PROGRESS] Tortoise score from chain:", JSON.stringify(tortoiseScore, (_, v) => typeof v === "bigint" ? v.toString() : v));
    expect(tortoiseScore.final_value).toBe(1120n);
    expect(tortoiseScore.return_bps).toBe(1200n);
    expect(tortoiseScore.max_drawdown_bps).toBe(800n);
    expect(tortoiseScore.eligible).toBe(true);
    expect(tortoiseScore.score_bps).toBe(400n);
    console.log("[PROGRESS] Tortoise score assertions passed");

    // 5. Verify change note discovered by Alice
    const { notes: aliceNotes } = await transfers.alice.discoverNotes();
    const usdNotes = aliceNotes.get(BigInt(tokens.usdToken)) ?? [];
    const totalUsd = usdNotes.reduce((sum, n) => sum + n.amount, 0n);
    console.log("[PROGRESS] Alice USD notes total:", totalUsd.toString(), "expected:", depositAmount.toString());
    expect(totalUsd).toBe(depositAmount);
    console.log("[PROGRESS] Change-note assertion passed");

    // 6. Submit oversized Falcon action (700 units > 350 max allowed)
    const falconBigReceiptId = "0x46414c434f4e5f424947"; // 'FALCON_BIG'
    const falconAmount = 700n * ONE_TOKEN;
    const { callAndProof: falconCall } = await transfers.alice
      .build({
        autoSetup: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokens.usdToken)
      .withdraw({ recipient: adapterAddress, amount: falconAmount })
      .surplusTo(de.alice.address, false)
      .with(tokens.usdToken)
      .transfer({
        recipient: de.alice.address,
        amount: Open,
      })
      .done()
      .invoke((args) => {
        const openNote = args.openNotes[0];
        if (!openNote) {
          throw new Error("Expected one open note for Falcon action");
        }
        return {
          contractAddress: adapterAddress,
          calldata: [
            tokens.usdToken,
            de.privacy.address,
            openNote.noteId,
            falconBigReceiptId,
            FALCON_COMMIT,
            tokens.usdToken,
            MOCK_TARGET,
            700n, // allocation_units: 700 > 35% of 1000 (350)
            1000n, // portfolio_value_before
            1300n, // portfolio_value_after (rejected)
            0n, // drawdown_bps
          ],
        };
      })
      .execute();
    await devnet.executeOutside(falconCall);
    await env.indexer.waitForBlock(devnet.url);
    console.log("[PROGRESS] Falcon oversized privacy_invoke submitted and block indexed");

    // Falcon oversized action must be rejected: portfolio remains 1000
    const falconScore: any = await arenaContract.call("get_score", [
      FALCON_COMMIT,
    ]);
    console.log("[PROGRESS] Falcon score from chain:", JSON.stringify(falconScore, (_, v) => typeof v === "bigint" ? v.toString() : v));
    expect(falconScore.final_value).toBe(1000n);
    expect(falconScore.return_bps).toBe(0n);
    console.log("[PROGRESS] Falcon rejection assertions passed");

    // 7. Verify replay protection: replaying TORTOISE_OK receipt is rejected
    const { callAndProof: replayCall } = await transfers.alice
      .build({
        autoSetup: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokens.usdToken)
      .withdraw({ recipient: adapterAddress, amount: actionAmount })
      .surplusTo(de.alice.address, false)
      .with(tokens.usdToken)
      .transfer({
        recipient: de.alice.address,
        amount: Open,
      })
      .done()
      .invoke((args) => {
        const openNote = args.openNotes[0];
        return {
          contractAddress: adapterAddress,
          calldata: [
            tokens.usdToken,
            de.privacy.address,
            openNote.noteId,
            tortoiseReceiptId, // Replay TORTOISE_OK
            TORTOISE_COMMIT,
            tokens.usdToken,
            MOCK_TARGET,
            350n,
            1120n,
            1200n,
            800n,
          ],
        };
      })
      .execute();
    await devnet.executeOutside(replayCall);
    await env.indexer.waitForBlock(devnet.url);
    console.log("[PROGRESS] Replay attempt submitted and block indexed");

    // Score remains unchanged after duplicate rejection
    const tortoiseScoreAfterReplay: any = await arenaContract.call("get_score", [
      TORTOISE_COMMIT,
    ]);
    console.log("[PROGRESS] Tortoise score after replay attempt:", JSON.stringify(tortoiseScoreAfterReplay, (_, v) => typeof v === "bigint" ? v.toString() : v));
    expect(tortoiseScoreAfterReplay.final_value).toBe(1120n);
    console.log("[PROGRESS] Replay rejection assertion passed — score unchanged");
  });
});
