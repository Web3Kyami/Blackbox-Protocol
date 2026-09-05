import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, hash } from "starknet";
import { Devnet } from "@starkware-libs/starknet-privacy-sdk/testing";
import { Open } from "@starkware-libs/starknet-privacy-sdk";
import {
  createE2eTestEnv,
  getDevnetProvider,
  type E2eTestEnv,
} from "../src/harness.js";
import {
  projectRoot,
  declareClass,
  deployContract,
  executeAndWait,
  u256Calldata,
} from "../src/utils.js";
import { join } from "path";
import { readFileSync } from "fs";

const CONTRACTS_DEV_DIR = join(projectRoot(), "contracts/target/dev");
const PREFIX = "blackbox_arena_contracts";

function artifact(name: string, compiled = false): string {
  const suffix = compiled
    ? "compiled_contract_class.json"
    : "contract_class.json";
  return join(CONTRACTS_DEV_DIR, `${PREFIX}_${name}.${suffix}`);
}

describe("BlackBox Protocol capability on Devnet", () => {
  let devnet: Devnet;
  let environment: E2eTestEnv;

  beforeAll(async () => {
    devnet = new Devnet();
    environment = await createE2eTestEnv(devnet, {
      indexer: { logFile: "blackbox-capability-indexer.log" },
    });
  });

  afterAll(async () => {
    await environment?.indexer.shutdown();
    await devnet?.cleanup();
  });

  it("shields, privately exercises, and rediscovers a reusable bearer pass", async () => {
    const { env, transfers, indexer } = environment;
    const provider = getDevnetProvider(env);
    const gatekeeperClassHash = await declareClass(
      env.admin,
      provider,
      artifact("CapabilityGatekeeper"),
      artifact("CapabilityGatekeeper", true),
    );
    const tokenClassHash = await declareClass(
      env.admin,
      provider,
      artifact("CapabilityToken"),
      artifact("CapabilityToken", true),
    );
    const targetClassHash = await declareClass(
      env.admin,
      provider,
      artifact("MockCapabilityTarget"),
      artifact("MockCapabilityTarget", true),
    );

    const gatekeeperAddress = await deployContract(
      env.admin,
      provider,
      gatekeeperClassHash,
      [env.privacy.address],
      "0xCA01",
    );
    const tokenAddress = await deployContract(
      env.admin,
      provider,
      tokenClassHash,
      [
        BigInt("0x424c41434b424f585f50415353"), // BLACKBOX_PASS
        BigInt("0x424250"), // BBP
        env.admin.address,
        env.privacy.address,
        gatekeeperAddress,
      ],
      "0xCA02",
    );
    const targetAddress = await deployContract(
      env.admin,
      provider,
      targetClassHash,
      [gatekeeperAddress],
      "0xCA03",
    );

    const latest = await provider.getBlock("latest");
    const selector = hash.getSelectorFromName("set_value");
    await executeAndWait(env.admin, provider, {
      contractAddress: gatekeeperAddress,
      entrypoint: "register_policy",
      calldata: [
        tokenAddress,
        targetAddress,
        selector,
        1n, // enforce first-argument maximum
        500n,
        BigInt(latest.timestamp) + 10_000n,
        1n, // reusable
      ],
    });

    await executeAndWait(env.admin, provider, {
      contractAddress: tokenAddress,
      entrypoint: "mint",
      calldata: [env.alice.address, ...u256Calldata(1n)],
    });
    await executeAndWait(env.alice, provider, {
      contractAddress: tokenAddress,
      entrypoint: "approve",
      calldata: [env.privacy.address, ...u256Calldata(1n)],
    });

    const { callAndProof: depositCall } = await transfers.alice
      .build({
        autoRegister: true,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokenAddress, (token) => token.deposit({ amount: 1n }))
      .surplusTo(env.alice.address)
      .execute();
    await devnet.executeOutside(depositCall);
    await indexer.waitForBlock(devnet.url);

    const { notes: notesBeforeUse } = await transfers.alice.discoverNotes();
    const passNotesBeforeUse = notesBeforeUse.get(BigInt(tokenAddress)) ?? [];
    expect(passNotesBeforeUse.reduce((sum, note) => sum + note.amount, 0n)).toBe(1n);

    const { callAndProof: useCall } = await transfers.alice
      .build({
        autoSetup: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokenAddress)
      .withdraw({ recipient: gatekeeperAddress, amount: 1n })
      .transfer({ recipient: env.alice.address, amount: Open })
      .done()
      .invoke(({ openNotes }) => {
        const returnedPass = openNotes[0];
        if (!returnedPass) throw new Error("Expected reusable-pass open note");
        return {
          contractAddress: gatekeeperAddress,
          calldata: [
            tokenAddress,
            targetAddress,
            selector,
            1n, // Span length
            321n, // approved target calldata
            returnedPass.noteId,
          ],
        };
      })
      .execute();
    const useReceipt = await devnet.executeOutside(useCall);
    if (!useReceipt.isSuccess()) {
      throw new Error("Capability outside-execution transaction did not succeed");
    }
    expect(useReceipt.isSuccess()).toBe(true);
    const useTransactionHash = useReceipt.transaction_hash;
    const submittedTransaction: any = await provider.getTransaction(
      useTransactionHash,
    );
    // Alice constructs the proof, but a distinct outside-execution account
    // submits it. Direct submission by Alice would reveal Alice as tx sender.
    expect(BigInt(submittedTransaction.sender_address)).toBe(
      BigInt(env.admin.address),
    );
    expect(BigInt(submittedTransaction.sender_address)).not.toBe(
      BigInt(env.alice.address),
    );
    await indexer.waitForBlock(devnet.url);

    const targetArtifact = JSON.parse(
      readFileSync(artifact("MockCapabilityTarget"), "utf8"),
    );
    const target = new Contract({
      abi: targetArtifact.abi,
      address: targetAddress,
      providerOrAccount: provider,
    });
    expect(await target.call("get_value")).toBe(321n);
    expect(await target.call("get_call_count")).toBe(1n);

    const gatekeeperArtifact = JSON.parse(
      readFileSync(artifact("CapabilityGatekeeper"), "utf8"),
    );
    const gatekeeper = new Contract({
      abi: gatekeeperArtifact.abi,
      address: gatekeeperAddress,
      providerOrAccount: provider,
    });
    const policy: any = await gatekeeper.call("get_policy", [tokenAddress]);
    expect(policy[8] ?? policy.uses).toBe(1n);

    const { notes: notesAfterUse } = await transfers.alice.discoverNotes();
    const passNotesAfterUse = notesAfterUse.get(BigInt(tokenAddress)) ?? [];
    expect(passNotesAfterUse.reduce((sum, note) => sum + note.amount, 0n)).toBe(1n);

    // Exercise the second promised mode against the same real pool: a
    // one-shot pass must execute once, burn, and create no replacement note.
    const oneShotTokenAddress = await deployContract(
      env.admin,
      provider,
      tokenClassHash,
      [
        BigInt("0x424c41434b424f585f4f4e455f53484f54"), // BLACKBOX_ONE_SHOT
        BigInt("0x42424f53"), // BBOS
        env.admin.address,
        env.privacy.address,
        gatekeeperAddress,
      ],
      "0xCA04",
    );
    await executeAndWait(env.admin, provider, {
      contractAddress: gatekeeperAddress,
      entrypoint: "register_policy",
      calldata: [
        oneShotTokenAddress,
        targetAddress,
        selector,
        1n,
        500n,
        BigInt(latest.timestamp) + 10_000n,
        0n, // one-shot
      ],
    });
    await executeAndWait(env.admin, provider, {
      contractAddress: oneShotTokenAddress,
      entrypoint: "mint",
      calldata: [env.alice.address, ...u256Calldata(1n)],
    });
    await executeAndWait(env.alice, provider, {
      contractAddress: oneShotTokenAddress,
      entrypoint: "approve",
      calldata: [env.privacy.address, ...u256Calldata(1n)],
    });
    const { callAndProof: oneShotDepositCall } = await transfers.alice
      .build({
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(oneShotTokenAddress, (token) => token.deposit({ amount: 1n }))
      .surplusTo(env.alice.address)
      .execute();
    await devnet.executeOutside(oneShotDepositCall);
    await indexer.waitForBlock(devnet.url);

    const { callAndProof: oneShotUseCall } = await transfers.alice
      .build({
        autoSetup: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(oneShotTokenAddress)
      .withdraw({ recipient: gatekeeperAddress, amount: 1n })
      .done()
      .invoke(() => ({
        contractAddress: gatekeeperAddress,
        calldata: [
          oneShotTokenAddress,
          targetAddress,
          selector,
          1n,
          123n,
          0n, // one-shot policies forbid a return note
        ],
      }))
      .execute();
    await devnet.executeOutside(oneShotUseCall);
    await indexer.waitForBlock(devnet.url);

    expect(await target.call("get_value")).toBe(123n);
    expect(await target.call("get_call_count")).toBe(2n);
    const oneShotArtifact = JSON.parse(
      readFileSync(artifact("CapabilityToken"), "utf8"),
    );
    const oneShotToken = new Contract({
      abi: oneShotArtifact.abi,
      address: oneShotTokenAddress,
      providerOrAccount: provider,
    });
    expect(await oneShotToken.call("total_supply")).toBe(0n);
    const { notes: finalNotes } = await transfers.alice.discoverNotes();
    const remainingOneShotNotes =
      finalNotes.get(BigInt(oneShotTokenAddress)) ?? [];
    expect(
      remainingOneShotNotes.reduce((sum, note) => sum + note.amount, 0n),
    ).toBe(0n);
  });
});
