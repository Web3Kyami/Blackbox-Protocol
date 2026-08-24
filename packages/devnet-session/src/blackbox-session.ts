import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "http";
import { Contract, hash, type Account, type RpcProvider } from "../../../_research/starknet-privacy/e2e/node_modules/starknet/dist/index.js";
import { Devnet } from "../../../_research/starknet-privacy/sdk/dist/testing/index.js";
import { Open } from "../../../_research/starknet-privacy/sdk/dist/index.js";
import { createE2eTestEnv, type E2eTestEnv } from "./harness.js";
import { deployTestTokens, type TokenAddresses } from "./vesu-setup.js";
import {
  declareClass,
  deployContract,
  executeAndWait,
  u256Calldata,
  repoRoot,
  arenaRepoRoot,
} from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DEV_DIR = join(arenaRepoRoot(), "contracts/target/dev");

export const FALCON_COMMIT = "0x46414c434f4e5f434f4d4d4954"; // 'FALCON_COMMIT'
export const TORTOISE_COMMIT = "0x544f52544f4953455f434f4d4d4954"; // 'TORTOISE_COMMIT'
export const PULSE_COMMIT = "0x50554c53455f434f4d4d4954"; // 'PULSE_COMMIT'
export const MOCK_TARGET = "0x123456789";

export interface RulesCommitmentParams {
  startTime: bigint;
  endTime: bigint;
  startingUnits: bigint;
  maxAllocationBps: number;
  maxDrawdownBps: number;
  prizeCapUnits: bigint;
  allowedAssets: string[];
  allowedTargets: string[];
}

function canonicalizeRules(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeRules).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeRules((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

export function computeRulesCommitment(params: RulesCommitmentParams): string {
  const canonical = canonicalizeRules({
    startTime: params.startTime,
    endTime: params.endTime,
    startingUnits: params.startingUnits,
    maxAllocationBps: params.maxAllocationBps,
    maxDrawdownBps: params.maxDrawdownBps,
    prizeCapUnits: params.prizeCapUnits,
    allowedAssets: params.allowedAssets,
    allowedTargets: params.allowedTargets,
  });
  // felt252 holds 31 bytes; truncate SHA-256 (32 bytes) to fit.
  const digest = createHash("sha256").update(canonical).digest("hex");
  return "0x" + digest.slice(0, 62);
}

export function feltToShortString(feltHex: string | bigint): string {
  let hex = typeof feltHex === "bigint" ? feltHex.toString(16) : feltHex.replace(/^0x/, "");
  if (hex.length % 2 !== 0) hex = "0" + hex;
  try {
    const buf = Buffer.from(hex, "hex");
    const str = buf.toString("utf8");
    if (/^[A-Za-z0-9_]+$/.test(str)) {
      return str;
    }
  } catch {
    // fallback
  }
  return "0x" + hex;
}

export interface BlackboxSessionAddresses {
  arenaAddress: string;
  adapterAddress: string;
  privacyPoolAddress: string;
  usdTokenAddress: string;
  sponsorAddress: string;
  aliceAddress: string;
  bobAddress: string;
}

export interface BlackboxSessionClassHashes {
  arenaClassHash: string;
  adapterClassHash: string;
}

export interface SessionActionReceipt {
  receiptId: string;
  strategyCommitment: string;
  reasonCode: string;
  accepted: boolean;
  timestamp: string;
  txHash?: string;
  blockNumber?: number;
}

export interface SanitizedSessionManifest {
  status: "active" | "stopped";
  rpcUrl: string;
  wsUrl: string;
  chainId: string;
  blockNumber: number;
  addresses: BlackboxSessionAddresses;
  classHashes: BlackboxSessionClassHashes;
  configuredAdapterAddress: string;
  adapterLocked: boolean;
  rulesCommitment: string;
  assetPrices: Record<string, { price: string; timestamp: number }>;
  strategyRegistrants: Record<string, string>;
  prizeToken: string;
  prizeDeposited: number;
  roundParams: {
    startTime: string;
    endTime: string;
    startingUnits: string;
    maxAllocationBps: number;
    maxDrawdownBps: number;
    prizeCapUnits: string;
    allowedAssets: string[];
    allowedTargets: string[];
    prizeToken: string;
  };
  closed: boolean;
  settled: boolean;
  winner: string;
  settlementAmount: number;
  timestamp: string;
}

export interface SubmitActionParams {
  strategyCommitment: string;
  receiptId?: string;
  allocationUnits?: number | bigint;
  portfolioValueBefore?: number | bigint;
  portfolioValueAfter?: number | bigint;
  drawdownBps?: number;
}

export interface BlackboxSession {
  devnet: Devnet;
  env: E2eTestEnv;
  tokens: TokenAddresses;
  arenaAddress: string;
  adapterAddress: string;
  arenaClassHash: string;
  adapterClassHash: string;
  rpcUrl: string;
  wsUrl: string;
  startTime: bigint;
  endTime: bigint;
  addresses: BlackboxSessionAddresses;
  classHashes: BlackboxSessionClassHashes;
  arenaContract: Contract;
  shutdown: () => Promise<void>;
  getSanitizedManifest: () => Promise<SanitizedSessionManifest>;
  recordReceipt: (receipt: SessionActionReceipt) => void;
  getReceipts: () => SessionActionReceipt[];
  registerStrategy: (commitment: string) => Promise<{ txHash: string; commitment: string }>;
  submitShieldedAction: (params: SubmitActionParams) => Promise<{ txHash: string; receiptId: string; reasonCode: string; accepted: boolean }>;
  closeRound: (options?: { advanceTime?: boolean }) => Promise<{ txHash: string; winner: string }>;
  settleRound: (amountUnits: number | bigint) => Promise<{ txHash: string; winner: string; amountUnits: string }>;
}

/**
 * Setup a complete, real Blackbox Arena Devnet session.
 * Deploys USD TestToken, Privacy pool, Arena, ArenaAdapter,
 * executes sequential set_action_adapter lock, and registers initial strategies.
 */
export async function setupBlackboxSession(options?: {
  startTimeOffsetSec?: number;
  registerDefaultStrategies?: boolean;
}): Promise<BlackboxSession> {
  const devnet = new Devnet();
  const env = await createE2eTestEnv(devnet, {
    indexer: { logFile: "blackbox-arena-indexer.log" },
  });

  const { admin, provider } = env.env;
  const tokens = await deployTestTokens(admin, provider);

  // 1. Declare Arena and ArenaAdapter classes
  const arenaArtifact = JSON.parse(
    readFileSync(
      join(CONTRACTS_DEV_DIR, "blackbox_arena_contracts_Arena.contract_class.json"),
      "utf8",
    ),
  );

  const arenaClassHash = await declareClass(
    admin,
    provider,
    join(CONTRACTS_DEV_DIR, "blackbox_arena_contracts_Arena.contract_class.json"),
    join(
      CONTRACTS_DEV_DIR,
      "blackbox_arena_contracts_Arena.compiled_contract_class.json",
    ),
  );

  const adapterClassHash = await declareClass(
    admin,
    provider,
    join(
      CONTRACTS_DEV_DIR,
      "blackbox_arena_contracts_ArenaAdapter.contract_class.json",
    ),
    join(
      CONTRACTS_DEV_DIR,
      "blackbox_arena_contracts_ArenaAdapter.compiled_contract_class.json",
    ),
  );

  // 2. Deploy Arena (sequential deployment: starts with zero adapter)
  const now = Math.floor(Date.now() / 1000);
  const offset = options?.startTimeOffsetSec ?? 60;
  const startTime = BigInt(now + offset);
  const endTime = BigInt(now + 10000);
  const rulesCommitmentHex = computeRulesCommitment({
    startTime,
    endTime,
    startingUnits: 1000n,
    maxAllocationBps: 3500,
    maxDrawdownBps: 2000,
    prizeCapUnits: 100n,
    allowedAssets: [tokens.usdToken],
    allowedTargets: [MOCK_TARGET],
  });

  const arenaAddress = await deployContract(
    admin,
    provider,
    arenaClassHash,
    [
      admin.address,
      startTime,
      endTime,
      1000n, // starting_units
      3500n, // max_allocation_bps (35%)
      2000n, // max_drawdown_bps (20%)
      100n, // prize_cap_units
      tokens.usdToken, // prize_token
      1n, // initial_assets: Span<ContractAddress> serialized as [len, elem...]
      tokens.usdToken,
      1n, // initial_targets: Span<ContractAddress> serialized as [len, elem...]
      MOCK_TARGET,
      BigInt(rulesCommitmentHex),
    ],
    "0x800",
  );

  // 3. Deploy ArenaAdapter (configured with privacy pool and arena address)
  const adapterAddress = await deployContract(
    admin,
    provider,
    adapterClassHash,
    [env.env.privacy.address, arenaAddress],
    "0x801",
  );

  // 4. Safe sequential link: Sponsor sets action adapter once before registration
  await executeAndWait(admin, provider, {
    contractAddress: arenaAddress,
    entrypoint: "set_action_adapter",
    calldata: [adapterAddress],
  });

  // 5. Set sponsor-signed price for each allowed asset before registration
  const PRICE_18_DECIMALS = BigInt("1000000000000000000"); // 1.0 in 18 decimals
  await executeAndWait(admin, provider, {
    contractAddress: arenaAddress,
    entrypoint: "set_price",
    calldata: [tokens.usdToken, PRICE_18_DECIMALS],
  });

  // 5b. Fund the escrowed prize (P4.3): sponsor mints, approves, deposits the cap
  const PRIZE_UNITS = 100n;
  await executeAndWait(admin, provider, {
    contractAddress: tokens.usdToken,
    entrypoint: "mint",
    calldata: [admin.address, ...u256Calldata(1_000_000n)],
  });
  await executeAndWait(admin, provider, {
    contractAddress: tokens.usdToken,
    entrypoint: "approve",
    calldata: [arenaAddress, ...u256Calldata(1_000_000n)],
  });
  await executeAndWait(admin, provider, {
    contractAddress: arenaAddress,
    entrypoint: "deposit_prize",
    calldata: [PRIZE_UNITS],
  });

  // 6. Register initial strategies if requested (default: true)
  const knownCommitments = new Set<string>();
  if (options?.registerDefaultStrategies !== false) {
    await executeAndWait(admin, provider, {
      contractAddress: arenaAddress,
      entrypoint: "register_strategy",
      calldata: [FALCON_COMMIT],
    });
    await executeAndWait(admin, provider, {
      contractAddress: arenaAddress,
      entrypoint: "register_strategy",
      calldata: [TORTOISE_COMMIT],
    });
    await executeAndWait(admin, provider, {
      contractAddress: arenaAddress,
      entrypoint: "register_strategy",
      calldata: [PULSE_COMMIT],
    });
    knownCommitments.add(FALCON_COMMIT);
    knownCommitments.add(TORTOISE_COMMIT);
    knownCommitments.add(PULSE_COMMIT);
  }

  const addresses: BlackboxSessionAddresses = {
    arenaAddress,
    adapterAddress,
    privacyPoolAddress: env.env.privacy.address,
    usdTokenAddress: tokens.usdToken,
    sponsorAddress: env.env.admin.address,
    aliceAddress: env.env.alice.address,
    bobAddress: env.env.bob.address,
  };

  const classHashes: BlackboxSessionClassHashes = {
    arenaClassHash,
    adapterClassHash,
  };

  const arenaContract = new Contract({
    abi: arenaArtifact.abi,
    address: arenaAddress,
    providerOrAccount: provider,
  });

  const sessionReceipts: SessionActionReceipt[] = [];

  const recordReceipt = (receipt: SessionActionReceipt) => {
    sessionReceipts.push(receipt);
  };

  const getReceipts = (): SessionActionReceipt[] => {
    return [...sessionReceipts];
  };

  // Idempotent Alice funding: check if Alice already has shielded USD notes before minting
  let aliceFunded = false;
  const ensureFundedAlice = async () => {
    if (aliceFunded) return;
    try {
      const { notes: aliceNotes } = await env.transfers.alice.discoverNotes();
      const usdNotes = aliceNotes.get(BigInt(tokens.usdToken)) ?? [];
      const totalUsd = usdNotes.reduce((sum: bigint, n: any) => sum + n.amount, 0n);
      if (totalUsd >= 350n * (10n ** 18n)) {
        aliceFunded = true;
        return;
      }
    } catch {
      // discover failed or fresh; proceed to mint
    }

    const ONE_TOKEN = 10n ** 18n;
    const depositAmount = 1000n * ONE_TOKEN;

    const mintTx = await admin.execute({
      contractAddress: tokens.usdToken,
      entrypoint: "mint",
      calldata: [env.env.alice.address, ...u256Calldata(depositAmount)],
    });
    await provider.waitForTransaction(mintTx.transaction_hash);

    const approveTx = await env.env.alice.execute({
      contractAddress: tokens.usdToken,
      entrypoint: "approve",
      calldata: [env.env.privacy.address, ...u256Calldata(depositAmount)],
    });
    await provider.waitForTransaction(approveTx.transaction_hash);

    const { callAndProof: depositCall } = await env.transfers.alice
      .build({
        autoRegister: true,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(tokens.usdToken, (token: any) =>
        token.deposit({ amount: depositAmount }),
      )
      .surplusTo(env.env.alice.address)
      .execute();
    await devnet.executeOutside(depositCall);
    await env.indexer.waitForBlock(devnet.url);
    aliceFunded = true;
  };

  const registerStrategy = async (commitment: string): Promise<{ txHash: string; commitment: string }> => {
    const tx = await executeAndWait(admin, provider, {
      contractAddress: arenaAddress,
      entrypoint: "register_strategy",
      calldata: [commitment],
    });
    knownCommitments.add(commitment);
    return {
      txHash: tx.transaction_hash,
      commitment,
    };
  };

  const submitShieldedAction = async (params: SubmitActionParams): Promise<{
    txHash: string;
    receiptId: string;
    reasonCode: string;
    accepted: boolean;
  }> => {
    // Ensure round is active by advancing time past startTime if needed
    try {
      const block = await provider.getBlock("latest");
      if (BigInt(block.timestamp) < startTime) {
        await fetch(devnet.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "devnet_setTime",
            params: { time: Number(startTime) + 2 },
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
      }
    } catch (err) {
      console.warn("[session] Devnet time check notice:", err);
    }

    await ensureFundedAlice();

    const de = env.env;
    const ONE_TOKEN = 10n ** 18n;
    const allocationUnits = BigInt(params.allocationUnits ?? 350);
    const actionAmount = allocationUnits * ONE_TOKEN;
    const portfolioBefore = BigInt(params.portfolioValueBefore ?? 1000);
    const portfolioAfter = BigInt(params.portfolioValueAfter ?? 1120);
    const drawdownBps = BigInt(params.drawdownBps ?? 800);

    const receiptId = params.receiptId || ("0x" + Buffer.from(`ACT_${Date.now()}_${Math.floor(Math.random() * 1000)}`).toString("hex"));

    const { callAndProof: actionCall } = await env.transfers.alice
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
      .invoke((args: any) => {
        const openNote = args.openNotes[0];
        if (!openNote) {
          throw new Error("Expected one open note for shielded action invocation");
        }
        return {
          contractAddress: adapterAddress,
          calldata: [
            tokens.usdToken,
            de.privacy.address,
            openNote.noteId,
            receiptId,
            params.strategyCommitment,
            tokens.usdToken,
            MOCK_TARGET,
            allocationUnits,
            portfolioBefore,
            portfolioAfter,
            drawdownBps,
          ],
        };
      })
      .execute();

    const receipt = await devnet.executeOutside(actionCall);
    await env.indexer.waitForBlock(devnet.url);

    // Extract ActionReceipt event from Arena contract
    let reasonCode = "ACCEPTED";
    let accepted = true;

    if (receipt && (receipt as any).events) {
      for (const ev of (receipt as any).events) {
        if (
          ev.from_address &&
          BigInt(ev.from_address) === BigInt(arenaAddress) &&
          ev.data &&
          ev.data.length >= 2
        ) {
          const rawReason = ev.data[0];
          const rawAccepted = ev.data[1];
          reasonCode = feltToShortString(rawReason);
          accepted =
            rawAccepted === "0x1" ||
            rawAccepted === "0x01" ||
            rawAccepted === 1n ||
            rawAccepted === 1;
          break;
        }
      }
    }

    // Capture the block reference for the evidence record (defensive, non-blocking)
    let blockNumber: number | undefined;
    try {
      const txReceipt = await provider.getTransactionReceipt(receipt.transaction_hash);
      const bn = (txReceipt as any)?.block_number;
      if (bn !== undefined && bn !== null) blockNumber = Number(bn);
    } catch {
      // Block reference unavailable; record without it rather than fail the action
    }

    const actionReceipt: SessionActionReceipt = {
      receiptId,
      strategyCommitment: params.strategyCommitment,
      reasonCode,
      accepted,
      timestamp: new Date().toISOString(),
      txHash: receipt.transaction_hash,
      blockNumber,
    };

    recordReceipt(actionReceipt);

    return {
      txHash: receipt.transaction_hash,
      receiptId,
      reasonCode,
      accepted,
    };
  };

  const closeRound = async (options?: { advanceTime?: boolean }): Promise<{ txHash: string; winner: string }> => {
    if (options?.advanceTime !== false) {
      try {
        await fetch(devnet.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "devnet_increaseTime",
            params: { time: 10005 },
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
      } catch (err) {
        console.warn("[session] devnet_increaseTime notice:", err);
      }
    }

    const tx = await executeAndWait(admin, provider, {
      contractAddress: arenaAddress,
      entrypoint: "close",
      calldata: [],
    });

    let winner = "0x0";
    try {
      const winnerCall: any = await arenaContract.call("get_winner");
      winner = typeof winnerCall === "bigint" ? "0x" + winnerCall.toString(16) : String(winnerCall);
    } catch (err) {
      console.warn("[session] Contract get_winner notice:", err);
    }

    return {
      txHash: tx.transaction_hash,
      winner,
    };
  };

  const settleRound = async (amountUnits: number | bigint): Promise<{ txHash: string; winner: string; amountUnits: string }> => {
    const tx = await executeAndWait(admin, provider, {
      contractAddress: arenaAddress,
      entrypoint: "settle",
      calldata: [BigInt(amountUnits)],
    });

    let winner = "0x0";
    let settledAmount = BigInt(amountUnits);

    try {
      const settlementCall: any = await arenaContract.call("get_settlement");
      if (settlementCall) {
        winner = typeof settlementCall[0] === "bigint" ? "0x" + settlementCall[0].toString(16) : String(settlementCall[0]);
        settledAmount = typeof settlementCall[1] === "bigint" ? settlementCall[1] : BigInt(settlementCall[1]);
      }
    } catch (err) {
      console.warn("[session] Contract get_settlement notice:", err);
    }

    return {
      txHash: tx.transaction_hash,
      winner,
      amountUnits: settledAmount.toString(),
    };
  };

  const shutdown = async () => {
    try {
      await env.indexer.shutdown();
    } catch {
      // ignore
    }
    try {
      await devnet.cleanup();
    } catch {
      // ignore
    }
  };

  const getSanitizedManifest = async (): Promise<SanitizedSessionManifest> => {
    let blockNumber = 0;
    try {
      const block = await provider.getBlock("latest");
      blockNumber = block.block_number;
    } catch {
      // ignore
    }

    // CONTRACT-VERIFIED ADAPTER LOCK AND RULES READ
    let configuredAdapterAddress = "0x0";
    let rulesCommitment = "0x0";
    const assetPrices: Record<string, { price: string; timestamp: number }> = {};
    const strategyRegistrants: Record<string, string> = {};
    let adapterLocked = false;
    let isClosed = false;
    let isSettled = false;
    let winnerCommitment = "0x0";
    let settlementAmount = 0;
    let prizeTokenAddress = "0x0";
    let prizeDepositedAmount = 0;

    try {
      const prizeTokenCall: any = await arenaContract.call("get_prize_token");
      const ptHex =
        typeof prizeTokenCall === "bigint"
          ? "0x" + prizeTokenCall.toString(16)
          : String(prizeTokenCall);
      if (ptHex && BigInt(ptHex) !== 0n) {
        prizeTokenAddress = ptHex;
      }
      const depositedCall: any = await arenaContract.call("get_prize_deposited");
      prizeDepositedAmount =
        typeof depositedCall === "bigint" ? Number(depositedCall) : Number(depositedCall || 0);
    } catch (err) {
      console.warn("[session] Contract read prize views failed:", err);
    }

    try {
      const adapterCall: any = await arenaContract.call("get_action_adapter");
      configuredAdapterAddress = typeof adapterCall === "bigint" ? "0x" + adapterCall.toString(16) : String(adapterCall);
      adapterLocked = Boolean(
        configuredAdapterAddress &&
        BigInt(configuredAdapterAddress) !== 0n &&
        BigInt(configuredAdapterAddress) === BigInt(adapterAddress),
      );
    } catch (err) {
      console.warn("[session] Contract read get_action_adapter failed:", err);
    }

    try {
      const rulesCall: any = await arenaContract.call("rules_commitment");
      rulesCommitment = typeof rulesCall === "bigint" ? "0x" + rulesCall.toString(16) : String(rulesCall);
    } catch (err) {
      console.warn("[session] Contract read rules_commitment failed:", err);
    }

    for (const asset of [tokens.usdToken]) {
      try {
        const priceCall: any = await arenaContract.call("get_price", [asset]);
        const tsCall: any = await arenaContract.call("get_price_timestamp", [asset]);
        const priceHex = typeof priceCall === "bigint" ? priceCall.toString(10) : String(priceCall);
        assetPrices[asset] = {
          price: priceHex,
          timestamp: Number(tsCall),
        };
      } catch {
        // Price not set or RPC failure; leave absent from manifest
      }
    }

    // CONTRACT-VERIFIED OPERATOR BINDING: registrant per tracked commitment
    for (const commitment of knownCommitments) {
      try {
        const regCall: any = await arenaContract.call("get_registrant", [commitment]);
        const regHex = typeof regCall === "bigint" ? "0x" + regCall.toString(16) : String(regCall);
        if (regHex && BigInt(regHex) !== 0n) {
          strategyRegistrants[commitment] = regHex;
        }
      } catch {
        // Read failed or unknown commitment; leave absent rather than fabricate
      }
    }

    try {
      const winnerCall: any = await arenaContract.call("get_winner");
      const wHex = typeof winnerCall === "bigint" ? "0x" + winnerCall.toString(16) : String(winnerCall);
      if (wHex && BigInt(wHex) !== 0n) {
        isClosed = true;
        winnerCommitment = wHex;
      }
    } catch {
      // Not closed yet
    }

    try {
      const settlementCall: any = await arenaContract.call("get_settlement");
      if (settlementCall) {
        const sWinner =
          settlementCall[0] !== undefined
            ? typeof settlementCall[0] === "bigint"
              ? "0x" + settlementCall[0].toString(16)
              : String(settlementCall[0])
            : settlementCall.winner !== undefined
              ? typeof settlementCall.winner === "bigint"
                ? "0x" + settlementCall.winner.toString(16)
                : String(settlementCall.winner)
              : "0x0";

        const sAmount =
          settlementCall[1] !== undefined
            ? typeof settlementCall[1] === "bigint"
              ? Number(settlementCall[1])
              : Number(settlementCall[1] || 0)
            : settlementCall.amount_units !== undefined
              ? typeof settlementCall.amount_units === "bigint"
                ? Number(settlementCall.amount_units)
                : Number(settlementCall.amount_units || 0)
              : 0;

        if (sWinner && BigInt(sWinner) !== 0n) {
          isSettled = true;
          isClosed = true;
          winnerCommitment = sWinner;
          settlementAmount = sAmount;
        }
      }
    } catch {
      // Not settled yet
    }

    return {
      status: "active",
      rpcUrl: devnet.url,
      wsUrl: devnet.wsUrl,
      chainId: "SN_SEPOLIA",
      blockNumber,
      addresses,
      classHashes,
      configuredAdapterAddress,
      adapterLocked,
      rulesCommitment,
      assetPrices,
      strategyRegistrants,
      prizeToken: prizeTokenAddress,
      prizeDeposited: prizeDepositedAmount,
      roundParams: {
        startTime: startTime.toString(),
        endTime: endTime.toString(),
        startingUnits: "1000",
        maxAllocationBps: 3500,
        maxDrawdownBps: 2000,
        prizeCapUnits: "100",
        allowedAssets: [tokens.usdToken],
        allowedTargets: [MOCK_TARGET],
        prizeToken: tokens.usdToken,
      },
      closed: isClosed,
      settled: isSettled,
      winner: winnerCommitment,
      settlementAmount,
      timestamp: new Date().toISOString(),
    };
  };

  return {
    devnet,
    env,
    tokens,
    arenaAddress,
    adapterAddress,
    arenaClassHash,
    adapterClassHash,
    rpcUrl: devnet.url,
    wsUrl: devnet.wsUrl,
    startTime,
    endTime,
    addresses,
    classHashes,
    arenaContract,
    shutdown,
    getSanitizedManifest,
    recordReceipt,
    getReceipts,
    registerStrategy,
    submitShieldedAction,
    closeRound,
    settleRound,
  };
}

async function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error("Request payload too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Malformed JSON in request body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

/**
 * Localhost session service server running on 127.0.0.1.
 * Holds signers strictly in memory and exposes sanitized endpoints.
 * Strictly enforces Origin allowlist.
 */
export class SessionServiceServer {
  private server: Server | null = null;
  private session: BlackboxSession | null = null;
  private port: number;
  private localDir: string;
  private allowedOrigins: Set<string>;

  constructor(port = 4174) {
    this.port = port;
    this.localDir = join(arenaRepoRoot(), ".local");
    this.allowedOrigins = new Set([
      "http://127.0.0.1:4173",
      "http://localhost:4173",
    ]);
  }

  public async start(): Promise<void> {
    if (!existsSync(this.localDir)) {
      mkdirSync(this.localDir, { recursive: true });
    }

    // Write PID for process supervision
    const pidFile = join(this.localDir, "session.pid");
    writeFileSync(pidFile, String(process.pid), "utf8");

    // Initialize the real Devnet session
    this.session = await setupBlackboxSession();

    // Write sanitized manifest (never contains private keys)
    const manifest = await this.session.getSanitizedManifest();
    const manifestPath = join(this.localDir, "devnet-session.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const origin = req.headers.origin;

      // Restrict Origin header: allow localhost dashboard or local non-browser requests
      if (origin) {
        if (!this.allowedOrigins.has(origin)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Forbidden: Origin not allowed" }));
          return;
        }
        res.setHeader("Access-Control-Allow-Origin", origin);
      } else {
        res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
      }

      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

      // 1. GET /api/health
      if (req.method === "GET" && url.pathname === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            devnetRunning: Boolean(this.session),
            indexerRunning: Boolean(this.session?.env.indexer),
            port: this.port,
          }),
        );
        return;
      }

      // 2. GET /api/devnet/session
      if (req.method === "GET" && url.pathname === "/api/devnet/session") {
        if (!this.session) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "stopped", error: "Session not active" }));
          return;
        }
        const manifest = await this.session.getSanitizedManifest();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(manifest));
        return;
      }

      // 3. GET /api/devnet/evidence
      if (req.method === "GET" && url.pathname === "/api/devnet/evidence") {
        if (!this.session) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "stopped", error: "Session not active" }));
          return;
        }
        const receipts = this.session.getReceipts();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ receipts }));
        return;
      }

      // 4. GET /api/devnet/abi/:contract
      if (req.method === "GET" && url.pathname.startsWith("/api/devnet/abi/")) {
        const name = url.pathname.replace("/api/devnet/abi/", "").trim();
        let fileName = "";
        if (name === "arena" || name === "Arena") {
          fileName = "blackbox_arena_contracts_Arena.contract_class.json";
        } else if (name === "adapter" || name === "ArenaAdapter") {
          fileName = "blackbox_arena_contracts_ArenaAdapter.contract_class.json";
        }

        if (fileName && existsSync(join(CONTRACTS_DEV_DIR, fileName))) {
          const content = JSON.parse(readFileSync(join(CONTRACTS_DEV_DIR, fileName), "utf8"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ abi: content.abi }));
          return;
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "ABI not found" }));
          return;
        }
      }

      // 5. POST /api/devnet/register
      if (req.method === "POST" && url.pathname === "/api/devnet/register") {
        if (!this.session) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not active" }));
          return;
        }
        try {
          const body = await parseJsonBody(req);
          const role = (body.role || "sponsor").toLowerCase();
          if (role !== "sponsor" && role !== "admin") {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized: Only sponsor account can register strategies" }));
            return;
          }
          if (!body.commitment || typeof body.commitment !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.commitment)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid commitment: must be a valid hex felt252" }));
            return;
          }

          const result = await this.session.registerStrategy(body.commitment);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, txHash: result.txHash, commitment: result.commitment }));
          return;
        } catch (err: any) {
          const message = err?.message || String(err);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
          return;
        }
      }

      // 6. POST /api/devnet/submit-action
      if (req.method === "POST" && url.pathname === "/api/devnet/submit-action") {
        if (!this.session) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not active" }));
          return;
        }
        try {
          const body = await parseJsonBody(req);
          const role = (body.role || "alice").toLowerCase();
          if (role === "bob") {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized: Bob is an observer/auditor and cannot submit actions" }));
            return;
          }
          if (!body.strategyCommitment || typeof body.strategyCommitment !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.strategyCommitment)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid strategyCommitment: must be a valid hex felt252" }));
            return;
          }

          const result = await this.session.submitShieldedAction({
            strategyCommitment: body.strategyCommitment,
            receiptId: body.receiptId,
            allocationUnits: body.allocationUnits,
            portfolioValueBefore: body.portfolioValueBefore,
            portfolioValueAfter: body.portfolioValueAfter,
            drawdownBps: body.drawdownBps,
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              txHash: result.txHash,
              receiptId: result.receiptId,
              reasonCode: result.reasonCode,
              accepted: result.accepted,
            }),
          );
          return;
        } catch (err: any) {
          const message = err?.message || String(err);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
          return;
        }
      }

      // 7. POST /api/devnet/close
      if (req.method === "POST" && url.pathname === "/api/devnet/close") {
        if (!this.session) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not active" }));
          return;
        }
        try {
          const body = await parseJsonBody(req);
          const role = (body.role || "sponsor").toLowerCase();
          if (role !== "sponsor" && role !== "admin") {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized: Only sponsor account can close the round" }));
            return;
          }

          const result = await this.session.closeRound({ advanceTime: body.advanceTime !== false });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, txHash: result.txHash, winner: result.winner }));
          return;
        } catch (err: any) {
          const message = err?.message || String(err);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
          return;
        }
      }

      // 8. POST /api/devnet/settle
      if (req.method === "POST" && url.pathname === "/api/devnet/settle") {
        if (!this.session) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not active" }));
          return;
        }
        try {
          const body = await parseJsonBody(req);
          const role = (body.role || "sponsor").toLowerCase();
          if (role !== "sponsor" && role !== "admin") {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized: Only sponsor account can settle the round" }));
            return;
          }

          const amount = Number(body.amountUnits ?? 100);
          if (isNaN(amount) || amount < 0 || amount > 100) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid amountUnits: must be between 0 and 100 (prize cap)" }));
            return;
          }

          const result = await this.session.settleRound(amount);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, txHash: result.txHash, winner: result.winner, amountUnits: result.amountUnits }));
          return;
        } catch (err: any) {
          const message = err?.message || String(err);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.session) {
      await this.session.shutdown();
      this.session = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    const pidFile = join(this.localDir, "session.pid");
    if (existsSync(pidFile)) {
      try {
        unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }
  }

  public getSession(): BlackboxSession | null {
    return this.session;
  }
}
