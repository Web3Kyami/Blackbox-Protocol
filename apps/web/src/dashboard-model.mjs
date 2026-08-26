/**
 * Blackbox Arena — Dashboard Presentation & State Normalization Model
 *
 * Pure functions for rendering, data normalization, and contract state parsing.
 * Shared between browser app and automated Node.js UI behavior tests.
 */

export const formatBps = (value) => `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;

export const shorten = (value) =>
  value && value.length > 18
    ? `${value.slice(0, 10)}\u2026${value.slice(-8)}`
    : value || "";

export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[character] || character,
  );

// Exact Cairo IArena Entrypoint Selectors (starknet_keccak) - must match compiled class 0x7ca7cd...10e360 (P1+Option B)
export const SELECTORS = {
  get_score:
    "0x009b2a59dab9794f9f1895ff5b5b621d7ad138084313beeb963003e9ca8ae684",
  get_action_adapter:
    "0x03170f9da0e2f3d2453d28f71e4a472c9cbcdcbcbf64aacc34010450c80a0cb0",
  rules_commitment:
    "0x0324ca8d3e029e2b353752b2033cb595e001cc9f8b3b0b9c5428daee38d0f9a8",
  get_winner:
    "0x0336ff46ef133890122ceba9cea282f1e4cf395392ce11e16672a6d486d6e9d1",
  get_settlement:
    "0x014d1aef6dfc39d7de75450df09b9d204dee404e099f01b193599c1fee3c5191",
  register_strategy:
    "0x02b11a95b0d38a29a1668ea57dfc75c3542370a67a8f0ebd183ec754e382ae83",
  get_registrant:
    "0x0127243b8992bc823fb86e1ebe48bd6a48da9973e630e55f563210ce03759c6c",
  // Option B attested float (P1+ attested scoring)
  get_float_token:
    "0x006b654b8cbc6a9892ecc3c32627d51f769918acf3d0ed005eddb502746b4f6a",
  get_attest_start:
    "0x036624c066c1b350a8cfca1bcebbdf51ac578ba3eee2bd8ead3b1bacef6aeb40",
  get_attest_peak:
    "0x00f4f23bab52236385d47a3b1701d809a7f4def8703bd78302a0c64538ef87b4",
  get_attest_max_dd:
    "0x012fd1267f78d42c902d2bc29455fda4aaa7df150a8be072e527277465600277",
  get_checkpoint_count:
    "0x006a477ce59a238f2051e0f929374bb7f3845cbd838a0dbac0feadff021a4dc0",
  get_checkpoint:
    "0x0041f5e6f76ee763c8e9adfcff7aca58b8c6cbad53ca1b9b000e3afa3885034f",
  get_action_counts:
    "0x005d9fd602e891b97e1cdaa71024991c62b05d1907e4cb8a4531f8805696a205",
  get_prize_token:
    "0x009b858ab225744a871bbc74820536cb0651c37013a91a1c57d172251f30ecc7",
  get_prize_deposited:
    "0x01f5d01d8d4b63664d974566cf2f00a5202971a5dca39c69578473096ebc0bdc",
  get_custody:
    "0x0153814673b7ff8e6ba62ca95a05b2da7e16656ae9c4880b49dcb321ae09690e",
  open_submit_action:
    "0x00472c953c8498ff14a56ad93404baa6500f1bdfc7dac33f62fbe593ba7eaf1f",
  set_float_token:
    "0x00b28bf57f052e729557cba8a330a78fc33f41a007c6ca98b783ece6b4105ca5",
  checkpoint:
    "0x0301d8d5f36bc5356cc801e43d2c4e4b360682ecbe538a8c576ec1a7d775975e",
};

// Known Strategy Commitments on Devnet
export const STRATEGIES = [
  { label: "Falcon", commitment: "0x46414c434f4e5f434f4d4d4954" },
  { label: "Tortoise", commitment: "0x544f52544f4953455f434f4d4d4954" },
  { label: "Pulse", commitment: "0x50554c53455f434f4d4d4954" },
];

export function lookupStrategyLabel(commitment) {
  if (!commitment) return "Unknown";
  const found = STRATEGIES.find(
    (s) => s.commitment.toLowerCase() === commitment.toLowerCase(),
  );
  if (found) return found.label;
  return shorten(commitment);
}

/**
 * Parse raw Starknet RPC starknet_call result into normalized Score object.
 * Strictly surfaces error states — NEVER fabricates fallback default scores.
 */
export function parseScoreEntry(jsonResult, strategy) {
  if (!jsonResult || typeof jsonResult !== "object") {
    return {
      label: strategy.label,
      commitment: strategy.commitment,
      error: true,
      errorReason: "Invalid RPC response",
    };
  }

  if (jsonResult.error) {
    return {
      label: strategy.label,
      commitment: strategy.commitment,
      error: true,
      errorReason: jsonResult.error.message || "Contract call reverted",
    };
  }

  const result = jsonResult.result;
  if (!Array.isArray(result) || result.length < 7) {
    return {
      label: strategy.label,
      commitment: strategy.commitment,
      error: true,
      errorReason: "Invalid contract response shape",
    };
  }

  try {
    const finalValue = Number(BigInt(result[1]));
    const _prime = (1n << 251n) + 17n * (1n << 192n) + 1n;
    const toSigned = (hex) => {
      const v = BigInt(hex);
      return v > _prime / 2n ? Number(v - _prime) : Number(v);
    };
    const returnBps = toSigned(result[2]);
    const maxDdBps = Number(BigInt(result[3]));
    const eligible = result[4] === "0x1" || result[4] === "0x01";
    const scoreBps = toSigned(result[5]);
    const regOrder = Number(BigInt(result[6]));

    return {
      label: strategy.label,
      commitment: strategy.commitment,
      finalValue,
      returnBps,
      maxDrawdownBps: maxDdBps,
      eligible,
      scoreBps: eligible ? scoreBps : null,
      registrationOrder: regOrder,
      error: false,
    };
  } catch (err) {
    return {
      label: strategy.label,
      commitment: strategy.commitment,
      error: true,
      errorReason: "Failed to parse contract return values",
    };
  }
}

/**
 * Parse settlement state from IArena.get_settlement result
 */
export function parseSettlementEntry(jsonResult) {
  if (!jsonResult || typeof jsonResult !== "object" || jsonResult.error) {
    return { settled: false, winner: "0x0", amountUnits: 0 };
  }
  const result = jsonResult.result;
  if (!Array.isArray(result) || result.length < 2) {
    return { settled: false, winner: "0x0", amountUnits: 0 };
  }
  try {
    const winnerHex = result[0];
    const amount = Number(BigInt(result[1]));
    const isSettled = winnerHex && BigInt(winnerHex) !== 0n;
    return {
      settled: isSettled,
      winner: isSettled ? winnerHex : "0x0",
      amountUnits: amount,
    };
  } catch {
    return { settled: false, winner: "0x0", amountUnits: 0 };
  }
}

/**
 * Sorts scores using the deterministic Arena ranking hierarchy:
 * 1. Eligible strategies beat disqualified strategies.
 * 2. Higher score_bps wins.
 * 3. Lower max_drawdown_bps breaks ties.
 * 4. Earlier registration_order breaks further ties.
 */
export function sortLeaderboard(scores) {
  return [...scores].sort((a, b) => {
    if (a.error || b.error) return 0;
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible && a.scoreBps !== b.scoreBps)
      return (b.scoreBps ?? 0) - (a.scoreBps ?? 0);
    if (a.maxDrawdownBps !== b.maxDrawdownBps)
      return a.maxDrawdownBps - b.maxDrawdownBps;
    return a.registrationOrder - b.registrationOrder;
  });
}

/**
 * Generates leaderboard HTML.
 * Explicitly surfaces "Score unavailable — contract read failed" on any failed reads.
 */
export function renderLeaderboardHtml(scores) {
  if (!scores || scores.length === 0) {
    return `<div class="loading-placeholder">No strategies registered.</div>`;
  }

  const hasErrors = scores.some((s) => s.error);

  if (hasErrors) {
    return scores
      .map((entry, index) => {
        if (entry.error) {
          return `
          <div class="leaderboard-row error-row">
            <span class="rank">#${index + 1}</span>
            <div class="agent">
              <span class="agent-mark">!</span>
              <div>
                <strong>${escapeHtml(entry.label)}</strong>
                <small>${escapeHtml(shorten(entry.commitment))}</small>
              </div>
            </div>
            <div class="metric" style="grid-column: span 4; color: var(--orange);">
              <strong>Score unavailable &mdash; contract read failed (${escapeHtml(entry.errorReason)})</strong>
            </div>
          </div>
        `.trim();
        }
        return renderScoreRowHtml(entry, index, false);
      })
      .join("\n");
  }

  const sorted = sortLeaderboard(scores);
  return sorted
    .map((entry, index) => {
      const isWinner =
        index === 0 &&
        entry.eligible &&
        entry.scoreBps !== null;
      return renderScoreRowHtml(entry, index, isWinner);
    })
    .join("\n");
}

export function renderScoreRowHtml(entry, index, isWinner) {
  return `
    <div class="leaderboard-row ${isWinner ? "winner" : ""}">
      <span class="rank">#${index + 1}</span>
      <div class="agent">
        <span class="agent-mark">${escapeHtml(entry.label.slice(0, 1))}</span>
        <div>
          <strong>${escapeHtml(entry.label)}</strong>
          <small>${escapeHtml(shorten(entry.commitment))}</small>
        </div>
      </div>
      <div class="metric"><small>FINAL VAL</small><strong>${entry.finalValue.toLocaleString()}</strong></div>
      <div class="metric"><small>RETURN</small><strong>${formatBps(entry.returnBps)}</strong></div>
      <div class="metric"><small>MAX DD</small><strong>${formatBps(entry.maxDrawdownBps)}</strong></div>
      <div class="score">
        <strong>${entry.scoreBps !== null ? `${entry.scoreBps} bps` : "\u2014"}</strong>
        <span class="result ${isWinner ? "winner" : entry.eligible ? "eligible" : "disqualified"}">
          ${isWinner ? "LEADER" : entry.eligible ? "ELIGIBLE" : "DISQUALIFIED"}
        </span>
      </div>
    </div>
  `.trim();
}

/**
 * Generates live evidence feed HTML.
 * Renders ONLY API-provided receipts; if empty, renders honest empty notice.
 * Each row surfaces its transaction reference when one exists.
 */
export function renderLiveEvidenceFeedHtml(receipts, network = "devnet", rpcUrl = "") {
  if (!receipts || receipts.length === 0) {
    return `<div class="loading-placeholder">No live action evidence in this session.</div>`;
  }

  return receipts
    .map(
      (r) => `
    <div class="feed-row">
      <span class="feed-status ${r.accepted ? "accepted" : "rejected"}">${r.accepted ? "\u2713" : "\u2715"}</span>
      <div>
        <strong>${escapeHtml(r.receiptId)} &middot; ${escapeHtml(r.accepted ? "ACCEPTED" : "REJECTED")}</strong>
        <span>${escapeHtml(r.reasonCode)}</span>
        <small>Strategy: ${escapeHtml(lookupStrategyLabel(r.strategyCommitment))} (${escapeHtml(shorten(r.strategyCommitment))})</small>
        ${renderReceiptTxRefHtml(r, network, rpcUrl)}
      </div>
      <time>${new Date(r.timestamp).toLocaleTimeString()}</time>
    </div>
  `.trim(),
    )
    .join("\n");
}

/**
 * Generates disconnected banner and offline status text.
 */
export function renderDisconnectedState() {
  return {
    topbarClass: "network disconnected",
    topbarText: "<i></i> Devnet Offline",
    bannerDisplay: "flex",
    arenaAddress: "Offline",
    blockNumber: "#---",
    rpcUrl: "127.0.0.1:---",
    leaderboardHtml: `<div class="loading-placeholder">&#x26A0; Devnet not running. Run <code>npm run devnet:session</code> from Windows PowerShell to connect.</div>`,
    feedHtml: `<div class="loading-placeholder">No live session connected.</div>`,
  };
}

// ── Wallet Self-Service (Starknet Wallet API, no external dependencies) ───────

/**
 * Detects an injected Starknet wallet provider (Ready/Argent, Braavos, or any
 * Starknet Wallet API implementation) on the given global object.
 * Returns { available: true, name, provider } or { available: false, name: null }.
 */
export function detectWalletProvider(globalObj = globalThis) {
  const candidate =
    globalObj?.starknet ?? globalObj?.starknet_braavos ?? globalObj?.starknet_argent;
  if (!candidate || typeof candidate.request !== "function") {
    return { available: false, name: null, provider: null };
  }
  let name = "Starknet Wallet";
  if (candidate.isReady === true || globalObj?.starknet_argentX === candidate)
    name = "Ready (Argent)";
  else if (candidate.isBraavos === true || globalObj?.starknet_braavos === candidate)
    name = "Braavos";
  return { available: true, name, provider: candidate };
}

const FELT252_MAX_HEX_DIGITS = 62; // felt252 is 31 bytes

/**
 * Validates and normalizes a user-supplied strategy commitment:
 * trims input, requires 0x-prefixed hex, enforces felt252 bounds.
 * Returns { ok: true, value } with lowercase hex, or { ok: false, error }.
 */
export function normalizeCommitment(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { ok: false, error: "Commitment is required." };
  }
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    return { ok: false, error: "Commitment must be 0x-prefixed hexadecimal." };
  }
  const digits = trimmed.slice(2);
  if (digits.length === 0 || !/^[0-9a-f]+$/.test(digits)) {
    return { ok: false, error: "Commitment must contain only hexadecimal digits." };
  }
  if (digits.length > FELT252_MAX_HEX_DIGITS) {
    return { ok: false, error: `Commitment exceeds felt252 range (max ${FELT252_MAX_HEX_DIGITS} hex digits).` };
  }
  return { ok: true, value: "0x" + digits };
}

/**
 * Builds a Starknet Wallet API call object for permissionless self-registration
 * of a strategy commitment by the connected operator account.
 */
export function buildRegisterStrategyCall(arenaAddress, commitment) {
  if (!arenaAddress || typeof arenaAddress !== "string") {
    throw new Error("Arena address is required.");
  }
  const normalized = normalizeCommitment(commitment);
  if (!normalized.ok) throw new Error(normalized.error);
  return {
    contractAddress: arenaAddress,
    entrypoint: SELECTORS.register_strategy,
    calldata: [normalized.value],
  };
}

/**
 * Parses a starknet_call result for get_registrant(commitment).
 * Returns { ok: true, registrant } or { ok: false, error } — never fabricates.
 */
export function parseRegistrantResult(jsonResult) {
  if (!jsonResult || typeof jsonResult !== "object") {
    return { ok: false, error: "Invalid RPC response" };
  }
  if (jsonResult.error) {
    return { ok: false, error: jsonResult.error.message || "Contract call reverted" };
  }
  const result = jsonResult.result;
  if (!Array.isArray(result) || result.length < 1) {
    return { ok: false, error: "Invalid contract response shape" };
  }
  try {
    const registrant = "0x" + BigInt(result[0]).toString(16);
    if (BigInt(result[0]) === 0n) {
      return { ok: false, error: "No registrant bound for this commitment." };
    }
    return { ok: true, registrant };
  } catch {
    return { ok: false, error: "Failed to parse registrant value" };
  }
}

/**
 * Maps common wallet/revert errors to operator-friendly messages.
 */
export function mapWalletError(err) {
  const message = String(err?.message ?? err ?? "");
  if (/DUP_STRATEGY|DUPLICATE_STRATEGY/i.test(message))
    return "This commitment is already registered in this Arena.";
  if (/REG_CLOSED|REGISTRATION_CLOSED/i.test(message))
    return "Registration closed: round has already started.";
  if (/User rejected|USER_REJECT|ABORTED/i.test(message))
    return "Transaction rejected in wallet.";
  if (/no accounts|not connected|connect/i.test(message))
    return "Connect your wallet first.";
  return message || "Unknown wallet error.";
}

// ── Evidence Completion: network labels, tx references, exports ───────────────

/**
 * Resolves the authoritative network label for a data source.
 * Every rendered surface must carry exactly one of these labels.
 */
export function networkLabelFor(source) {
  switch (source) {
    case "case-study":
      return { text: "SIMULATED", className: "settled" };
    case "devnet":
      return { text: "LOCAL DEVNET", className: "live" };
    case "sepolia":
      return { text: "SEPOLIA", className: "live" };
    case "mainnet":
      return { text: "MAINNET", className: "locked" };
    default:
      return { text: "OFFLINE", className: "disconnected" };
  }
}

/**
 * Returns a block-explorer URL for a transaction hash on the given network,
 * or null when no public explorer exists (local Devnet) or input is invalid.
 */
export function explorerTxUrlFor(network, rpcUrl, txHash) {
  if (!txHash || typeof txHash !== "string" || !txHash.startsWith("0x")) return null;
  if (network === "mainnet") return `https://voyager.online/tx/${txHash}`;
  if (network === "sepolia") return `https://sepolia.voyager.online/tx/${txHash}`;
  return null;
}

/**
 * Renders the transaction reference for an evidence receipt row:
 * always shows the hash; links to an explorer only when one exists.
 */
export function renderReceiptTxRefHtml(receipt, network, rpcUrl) {
  if (!receipt?.txHash) return "";
  const url = explorerTxUrlFor(network, rpcUrl, receipt.txHash);
  const hashText = escapeHtml(shorten(receipt.txHash));
  const block = Number.isFinite(receipt.blockNumber)
    ? ` &middot; blk #${escapeHtml(String(receipt.blockNumber))}`
    : "";
  if (url) {
    return `<span class="tx-ref"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="View transaction ${escapeHtml(receipt.txHash)}">${hashText}</a>${block}</span>`;
  }
  return `<span class="tx-ref" title="${escapeHtml(receipt.txHash)}">tx ${hashText}${block}</span>`;
}

/**
 * Builds canonical rules JSON exactly as hashed by the core engine's
 * commitRules(): recursively key-sorted object members, arrays in order,
 * bigint values as decimal strings. Returns { ok, json | error }.
 */
export function buildCanonicalRulesJson(params) {
  const canon = (value) => {
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canon(value[key])]),
      );
    }
    if (typeof value === "bigint") return value.toString();
    return value;
  };
  try {
    if (!params || typeof params !== "object") {
      return { ok: false, error: "Rules parameters are required." };
    }
    return { ok: true, json: JSON.stringify(canon(params)) };
  } catch (err) {
    return { ok: false, error: err?.message ?? "Canonicalization failed." };
  }
}

/**
 * Builds the downloadable evidence export payload: session metadata,
 * authoritative network label, and the exact receipts served by the API.
 */
export function buildEvidenceExportPayload(receipts, meta) {
  return {
    exportedAt: new Date().toISOString(),
    network: meta?.network ?? "devnet",
    networkLabel: networkLabelFor(meta?.network).text,
    arenaAddress: meta?.arenaAddress ?? null,
    rulesCommitment: meta?.rulesCommitment ?? null,
    receipts: Array.isArray(receipts) ? receipts : [],
  };
}

// ── Public-RPC Mode (Sepolia / Mainnet rehearsal) ───────────────────────────

export const SEPOLIA_B1_DEFAULTS = {
  arenaAddress: "0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51",
  adapterAddress: "0x42cfafc785c1abeb076c34bcad1e1f698a4e9cf8488a8fbb0ae783acec18c20",
  usdToken: "0x02d50cf1955c48a1089ae0be3a9d78733e79e667778650277a50945e9818b386",
  network: "sepolia",
  rpcHint: "https://starknet-sepolia-rpc.publicnode.com",
  proxyPath: "/api/rpc",
};

export const SEPOLIA_B1_STRATEGIES = [
  { label: "Tortoise (B1)", commitment: "0xb7dec731e959448027c464f2f71c30f6f55ecebe34702be548423fe0ecef" },
  { label: "Falcon (B1)", commitment: "0x3a01bec156e068db8c8bc1e1254e64f403392e2b4fd6881bfea687ec4ced" },
];

function parseSingleFeltResult(jsonResult) {
  if (!jsonResult || typeof jsonResult !== "object" || jsonResult.error) return null;
  const r = jsonResult.result;
  if (!Array.isArray(r) || r.length < 1) return null;
  try {
    return BigInt(r[0]);
  } catch {
    return null;
  }
}

export function parseFloatTokenResult(jsonResult) {
  const v = parseSingleFeltResult(jsonResult);
  if (v === null) return { ok: false, error: "Failed to read float_token" };
  if (v === 0n) return { ok: false, error: "float_token not set" };
  return { ok: true, token: "0x" + v.toString(16) };
}

export function parseAttestStartResult(jsonResult) {
  if (!jsonResult || typeof jsonResult !== "object" || jsonResult.error)
    return { ok: false, error: jsonResult?.error?.message || "attest_start read failed" };
  const r = jsonResult.result;
  if (!Array.isArray(r) || r.length < 1) return { ok: false, error: "Invalid attest_start shape" };
  try {
    const lo = BigInt(r[0]);
    const hi = r.length >= 2 ? BigInt(r[1]) : 0n;
    const raw = lo + (hi << 128n);
    return { ok: true, raw, rawHex: "0x" + raw.toString(16) };
  } catch {
    return { ok: false, error: "Failed to parse attest_start" };
  }
}

export function parseAttestPeakResult(jsonResult) {
  return parseAttestStartResult(jsonResult);
}

export function parseAttestMaxDdResult(jsonResult) {
  const v = parseSingleFeltResult(jsonResult);
  if (v === null) return { ok: false, error: "Failed to read max_dd" };
  try {
    return { ok: true, bps: Number(v) };
  } catch {
    return { ok: false, error: "Invalid max_dd" };
  }
}

export function parseCheckpointCountResult(jsonResult) {
  const v = parseSingleFeltResult(jsonResult);
  if (v === null) return { ok: false, error: "Failed to read checkpoint count" };
  try {
    return { ok: true, count: Number(v) };
  } catch {
    return { ok: false, error: "Invalid count" };
  }
}

export function parseCheckpointResult(jsonResult) {
  if (!jsonResult || typeof jsonResult !== "object" || jsonResult.error)
    return { ok: false, error: jsonResult?.error?.message || "checkpoint read failed" };
  const r = jsonResult.result;
  if (!Array.isArray(r) || r.length < 2) return { ok: false, error: "Invalid checkpoint shape" };
  try {
    let lo, hi, ts;
    if (r.length === 2) {
      lo = BigInt(r[0]);
      hi = 0n;
      ts = Number(BigInt(r[1]));
    } else {
      lo = BigInt(r[0]);
      hi = BigInt(r[1]);
      ts = Number(BigInt(r[2]));
    }
    const raw = lo + (hi << 128n);
    return { ok: true, balanceRaw: raw, balanceHex: "0x" + raw.toString(16), timestamp: ts };
  } catch {
    return { ok: false, error: "Failed to parse checkpoint" };
  }
}

export function parseActionCountsResult(jsonResult) {
  if (!jsonResult || typeof jsonResult !== "object" || jsonResult.error)
    return { ok: false, error: jsonResult?.error?.message || "action_counts read failed" };
  const r = jsonResult.result;
  if (!Array.isArray(r) || r.length < 2) return { ok: false, error: "Invalid action_counts shape" };
  try {
    return { ok: true, accepted: Number(BigInt(r[0])), rejected: Number(BigInt(r[1])) };
  } catch {
    return { ok: false, error: "Failed to parse action_counts" };
  }
}

export function formatUnits18(raw) {
  try {
    const v = typeof raw === "bigint" ? raw : BigInt(raw);
    const divisor = 10n ** 18n;
    const whole = v / divisor;
    const frac = v % divisor;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
    return `${whole}.${fracStr}`;
  } catch {
    return String(raw);
  }
}

export function resolvePublicRpcConfig({ searchParams, storage, hostname } = {}) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const get = (k) => params.get(k);
  const lsGet = (k) => {
    try {
      return storage ? storage.getItem(k) : null;
    } catch {
      return null;
    }
  };
  const rpcUrl = get("rpcUrl") || lsGet("bb:rpcUrl") || "";
  const arenaAddress = get("arena") || get("arenaAddress") || lsGet("bb:arenaAddress") || "";
  const adapterAddress = get("adapter") || lsGet("bb:adapterAddress") || "";
  const network = (get("network") || lsGet("bb:network") || "").toLowerCase();
  const forcePublic = get("public") === "1" || network === "sepolia" || network === "mainnet";
  const hasPublicConfig = Boolean(rpcUrl || arenaAddress || forcePublic);
  // Default to B1 Sepolia demo when public requested but no explicit arena
  const resolvedNetwork = network || (hasPublicConfig ? SEPOLIA_B1_DEFAULTS.network : "devnet");
  const resolvedArena = arenaAddress || (hasPublicConfig ? SEPOLIA_B1_DEFAULTS.arenaAddress : "");
  const resolvedAdapter = adapterAddress || (hasPublicConfig && resolvedArena === SEPOLIA_B1_DEFAULTS.arenaAddress ? SEPOLIA_B1_DEFAULTS.adapterAddress : "");
  const mainnetHint = "https://starknet-mainnet-rpc.publicnode.com";
  const fallbackHint = resolvedNetwork === "mainnet" ? mainnetHint : SEPOLIA_B1_DEFAULTS.rpcHint;
  const resolvedRpc = rpcUrl || (hasPublicConfig ? fallbackHint : "");
  return {
    mode: hasPublicConfig ? "public" : "devnet",
    rpcUrl: resolvedRpc,
    arenaAddress: resolvedArena,
    adapterAddress: resolvedAdapter,
    network: resolvedNetwork,
    forcePublic,
    hasPublicConfig,
  };
}

export function renderAttestedFloatHtml(entries) {
  if (!entries || entries.length === 0) {
    return `<div class="loading-placeholder">No attested float snapshots. Strategies must register and checkpoint on-chain.</div>`;
  }
  return entries
    .map((e) => {
      if (e.error) {
        return `<div class="attest-row error"><strong>${escapeHtml(e.label)}</strong> <span>${escapeHtml(e.error)}</span></div>`;
      }
      const start = e.start ? formatUnits18(e.start) : "--";
      const peak = e.peak ? formatUnits18(e.peak) : "--";
      const maxDd = e.maxDdBps != null ? formatBps(e.maxDdBps) : "--";
      const cp = e.checkpoints != null ? `${e.checkpoints} chkpt` : "";
      const bal = e.lastCheckpointBalance != null ? formatUnits18(e.lastCheckpointBalance) : "";
      return `<div class="attest-row"><strong>${escapeHtml(e.label)}</strong> <small>${escapeHtml(shorten(e.commitment))}</small> <span>start ${escapeHtml(start)}</span> <span>peak ${escapeHtml(peak)}</span> <span>maxDD ${escapeHtml(maxDd)}</span> <span>${escapeHtml(cp)} ${bal ? `last ${escapeHtml(bal)}` : ""}</span></div>`;
    })
    .join("\n");
}

export function renderPublicStatusHtml(config, state) {
  const addr = config.arenaAddress ? shorten(config.arenaAddress) : "not configured";
  const rpc = config.rpcUrl ? new URL(config.rpcUrl).hostname : "no RPC";
  if (state?.error) {
    return `<div class="loading-placeholder">Public RPC read failed: ${escapeHtml(state.error)} — check RPC URL and arena address. <a href="#" data-action="configure-public">Configure</a></div>`;
  }
  return `<div class="public-status">Public <strong>${escapeHtml(config.network)}</strong> &middot; arena ${escapeHtml(addr)} &middot; ${escapeHtml(rpc)}</div>`;
}

