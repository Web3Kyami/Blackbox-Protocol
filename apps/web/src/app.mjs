import {
  formatBps,
  shorten,
  escapeHtml,
  SELECTORS,
  STRATEGIES,
  lookupStrategyLabel,
  parseScoreEntry,
  parseSettlementEntry,
  parseRegistrantResult,
  renderLeaderboardHtml,
  renderLiveEvidenceFeedHtml,
  renderDisconnectedState,
  detectWalletProvider,
  normalizeCommitment,
  buildRegisterStrategyCall,
  mapWalletError,
  networkLabelFor,
  buildCanonicalRulesJson,
  buildEvidenceExportPayload,
  SEPOLIA_B1_DEFAULTS,
  SEPOLIA_B1_STRATEGIES,
  parseFloatTokenResult,
  parseAttestStartResult,
  parseAttestPeakResult,
  parseAttestMaxDdResult,
  parseCheckpointCountResult,
  parseCheckpointResult,
  parseActionCountsResult,
  formatUnits18,
  resolvePublicRpcConfig,
  renderAttestedFloatHtml,
  renderPublicStatusHtml,
} from "./dashboard-model.mjs";

let sessionData = null;
let caseStudyData = null;
let currentTab = "live"; // "live" | "case-study"
let lastReceiptId = "0x544f52544f4953455f4f4b"; // default replay candidate
let wallet = { provider: null, address: null, name: null };

let publicConfig = null;
let publicModeActive = false;

function getPublicConfig() {
  try {
    return resolvePublicRpcConfig({
      searchParams: new URLSearchParams(window.location.search),
      storage: window.localStorage,
      hostname: window.location.hostname,
    });
  } catch {
    return resolvePublicRpcConfig({ searchParams: new URLSearchParams(), storage: null, hostname: "" });
  }
}

async function starknetCall(rpcUrl, contractAddress, selector, calldata) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_call",
      params: [{ contract_address: contractAddress, entry_point_selector: selector, calldata }, "latest"],
    }),
  });
  return res.json();
}

// ── Lifecycle Initialization ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupStageCControls();
  setupWalletControls();
  setupPublicRpcControls();
  await loadCaseStudyFixture();
  publicConfig = getPublicConfig();
  await refreshDevnetState();

  const refreshBtn = document.querySelector("#refresh-devnet-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      publicConfig = getPublicConfig();
      if (publicModeActive) refreshPublicState();
      else refreshDevnetState();
    });
  }

  const exportBtn = document.querySelector("#export-evidence-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportEvidenceJson);
  }

  // Periodic polling for live session state (devnet or public)
  setInterval(() => {
    if (publicModeActive) refreshPublicState();
    else refreshDevnetState();
  }, 8000);
});

function getCurrentRole() {
  const select = document.querySelector("#account-select");
  return select ? select.value : "sponsor";
}

// ── Transaction Feedback Helpers ──────────────────────────────────────────────
function showTxProgress(title, message) {
  const banner = document.querySelector("#tx-feedback-banner");
  const icon = document.querySelector("#tx-feedback-icon");
  const titleEl = document.querySelector("#tx-feedback-title");
  const msgEl = document.querySelector("#tx-feedback-message");
  const details = document.querySelector("#tx-feedback-details");

  if (!banner) return;
  banner.className = "tx-feedback-banner";
  banner.style.display = "block";
  if (icon) icon.textContent = "\u23F3";
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (details) details.style.display = "none";
}

function showTxSuccess(title, message, data = {}) {
  const banner = document.querySelector("#tx-feedback-banner");
  const icon = document.querySelector("#tx-feedback-icon");
  const titleEl = document.querySelector("#tx-feedback-title");
  const msgEl = document.querySelector("#tx-feedback-message");
  const details = document.querySelector("#tx-feedback-details");
  const hashEl = document.querySelector("#tx-feedback-hash");
  const receiptRow = document.querySelector("#tx-receipt-row");
  const receiptEl = document.querySelector("#tx-feedback-receipt");
  const reasonRow = document.querySelector("#tx-reason-row");
  const reasonEl = document.querySelector("#tx-feedback-reason");

  if (!banner) return;
  banner.className = "tx-feedback-banner";
  banner.style.display = "block";
  if (icon) icon.textContent = "\u2705";
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  if (details && data.txHash) {
    details.style.display = "flex";
    if (hashEl) hashEl.textContent = data.txHash;

    if (receiptRow && receiptEl && data.receiptId) {
      receiptRow.style.display = "flex";
      receiptEl.textContent = data.receiptId;
    } else if (receiptRow) {
      receiptRow.style.display = "none";
    }

    if (reasonRow && reasonEl && data.reasonCode) {
      reasonRow.style.display = "flex";
      reasonEl.textContent = data.reasonCode;
      reasonEl.className = `status-badge ${data.accepted ? "live" : "locked"}`;
    } else if (reasonRow) {
      reasonRow.style.display = "none";
    }
  }
}

function showTxError(title, errorMsg) {
  const banner = document.querySelector("#tx-feedback-banner");
  const icon = document.querySelector("#tx-feedback-icon");
  const titleEl = document.querySelector("#tx-feedback-title");
  const msgEl = document.querySelector("#tx-feedback-message");
  const details = document.querySelector("#tx-feedback-details");

  if (!banner) return;
  banner.className = "tx-feedback-banner error";
  banner.style.display = "block";
  if (icon) icon.textContent = "\u274C";
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = errorMsg;
  if (details) details.style.display = "none";
}

// ── Wallet Self-Service Controls (Starknet Wallet API) ───────────────────────
function setupWalletControls() {
  const connectBtn = document.querySelector("#wallet-connect-btn");
  const selfRegBtn = document.querySelector("#self-register-btn");

  if (connectBtn) {
    const detection = detectWalletProvider(globalThis);
    if (!detection.available) {
      connectBtn.disabled = true;
      connectBtn.title = "No Starknet wallet detected. Install Ready (Argent) or Braavos.";
    }
    connectBtn.addEventListener("click", async () => {
      try {
        const accounts = await wallet.provider.request({ type: "wallet_requestAccounts" });
        if (!Array.isArray(accounts) || accounts.length === 0) {
          throw new Error("No accounts returned by wallet.");
        }
        wallet.address = accounts[0];
        wallet.name = detection.name;
        renderWalletChip();
        showTxSuccess("Wallet Connected", `${detection.name} connected. You can now join the Arena as an operator.`);
      } catch (err) {
        showTxError("Wallet Connection Failed", mapWalletError(err));
      }
    });
  }

  if (selfRegBtn) {
    selfRegBtn.addEventListener("click", async () => {
      const cfg = getPublicConfig();
      const inPublic = cfg.hasPublicConfig || publicModeActive;
      const arenaForJoin = inPublic ? cfg.arenaAddress : sessionData?.addresses?.arenaAddress;
      const rpcForJoin = inPublic ? cfg.rpcUrl : sessionData?.rpcUrl;
      const sessionOk = sessionData && sessionData.status === "active";
      if (!arenaForJoin || (!sessionOk && !inPublic)) {
        if (inPublic && !cfg.rpcUrl) {
          showTxError("Join Failed", "Public RPC not configured. Set rpcUrl in localStorage (bb:rpcUrl) or via ?rpcUrl=...&arena=0x...&network=sepolia.");
        } else if (inPublic) {
          showTxError("Join Failed", "Public arena not reachable. Check RPC URL and arena address in configuration.");
        } else {
          showTxError("Join Failed", "Devnet session is offline. Start the local session service first or append ?network=sepolia&arena=0x...&rpcUrl=... for Sepolia.");
        }
        return;
      }
      const input = document.querySelector("#self-reg-commitment-input");
      const normalized = normalizeCommitment(input?.value ?? "");
      if (!normalized.ok) {
        showTxError("Invalid Commitment", normalized.error);
        return;
      }

      // Late-bind provider: wallets may inject after page load.
      if (!wallet.provider) {
        const detection = detectWalletProvider(globalThis);
        if (!detection.available) {
          showTxError("No Wallet Detected", "Install Ready (Argent) or Braavos to join as an operator.");
          return;
        }
        wallet.provider = detection.provider;
        wallet.name = detection.name;
      }
      if (!wallet.address) {
        showTxError("Not Connected", "Connect your wallet first.");
        return;
      }

      let call;
      try {
        call = buildRegisterStrategyCall(arenaForJoin, normalized.value);
      } catch (err) {
        showTxError("Invalid Commitment", err.message);
        return;
      }

      showTxProgress(
        "Registering Strategy",
        `Signing register_strategy(${shorten(normalized.value)}) with ${wallet.name}...`,
      );
      try {
        const response = await wallet.provider.account.execute([call]);
        const txHash = response?.transaction_hash ?? String(response);
        showTxSuccess(
          "Registration Submitted",
          "Transaction accepted by the network. Verifying on-chain operator binding...",
          { txHash },
        );
        await verifyRegistrantBinding(normalized.value, txHash);
        if (publicModeActive) await refreshPublicState();
        else await refreshDevnetState();
      } catch (err) {
        showTxError("Registration Failed", mapWalletError(err));
      }
    });
  }
}

async function verifyRegistrantBinding(commitment, txHash) {
  const cfg = getPublicConfig();
  const arena = publicModeActive ? cfg.arenaAddress : sessionData?.addresses?.arenaAddress;
  const rpcUrl = publicModeActive ? cfg.rpcUrl : sessionData?.rpcUrl;
  if (!arena || !rpcUrl) return null;
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "starknet_call",
        params: [
          {
            contract_address: arena,
            entry_point_selector: SELECTORS.get_registrant,
            calldata: [commitment],
          },
          "latest",
        ],
      }),
    });
    const parsed = parseRegistrantResult(await res.json());
    if (parsed.ok && parsed.registrant.toLowerCase() === BigInt(wallet.address).toString(16)) {
      showTxSuccess(
        "Operator Binding Verified On-Chain",
        `Commitment ${shorten(commitment)} is bound to your account as registrant and prize recipient.`,
        { txHash },
      );
      return parsed.registrant;
    }
    if (parsed.ok) {
      showTxError(
        "Binding Mismatch",
        `On-chain registrant ${shorten(parsed.registrant)} does not match the connected account.`,
      );
    }
    return null;
  } catch {
    return null; // Read failure must not fabricate success
  }
}

function renderWalletChip() {
  const chip = document.querySelector("#wallet-address-chip");
  const btn = document.querySelector("#wallet-connect-btn");
  if (chip && wallet.address) {
    chip.style.display = "inline-block";
    chip.textContent = `${wallet.name}: ${shorten(wallet.address)}`;
    chip.title = wallet.address;
  }
  if (btn && wallet.address) btn.style.display = "none";
}

// ── Setup Stage C Interactive Controls ────────────────────────────────────────
function setupStageCControls() {
  const closeBannerBtn = document.querySelector("#tx-feedback-close");
  if (closeBannerBtn) {
    closeBannerBtn.addEventListener("click", () => {
      const banner = document.querySelector("#tx-feedback-banner");
      if (banner) banner.style.display = "none";
    });
  }

  // 1. Strategy Registration
  const regBtn = document.querySelector("#register-strategy-btn");
  const regInput = document.querySelector("#reg-commitment-input");
  if (regBtn && regInput) {
    regBtn.addEventListener("click", async () => {
      const commitment = regInput.value.trim();
      if (!commitment) {
        showTxError("Registration Error", "Please provide a strategy commitment.");
        return;
      }
      showTxProgress("Registering Strategy", `Calling Arena.register_strategy for ${commitment}...`);
      try {
        const res = await fetch("http://127.0.0.1:4174/api/devnet/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commitment, role: getCurrentRole() }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Registration transaction reverted");
        }
        showTxSuccess("Strategy Registered", `Strategy commitment successfully recorded on-chain.`, {
          txHash: json.txHash,
        });
        await refreshDevnetState();
      } catch (err) {
        showTxError("Registration Failed", err.message);
      }
    });
  }

  // 2. Shielded Action Presets
  const stratSelect = document.querySelector("#action-strat-select");
  const unitsInput = document.querySelector("#action-units-input");
  const valAfterInput = document.querySelector("#action-val-after-input");
  const ddInput = document.querySelector("#action-dd-input");

  const presetTortoiseBtn = document.querySelector("#preset-tortoise-btn");
  const presetFalconBtn = document.querySelector("#preset-falcon-btn");
  const presetReplayBtn = document.querySelector("#preset-replay-btn");

  if (presetTortoiseBtn) {
    presetTortoiseBtn.addEventListener("click", () => {
      if (presetTortoiseBtn) presetTortoiseBtn.className = "pill-btn active";
      if (presetFalconBtn) presetFalconBtn.className = "pill-btn";
      if (presetReplayBtn) presetReplayBtn.className = "pill-btn";
      if (stratSelect) stratSelect.value = "0x544f52544f4953455f434f4d4d4954";
      if (unitsInput) unitsInput.value = "350";
      if (valAfterInput) valAfterInput.value = "1120";
      if (ddInput) ddInput.value = "800";
    });
  }

  if (presetFalconBtn) {
    presetFalconBtn.addEventListener("click", () => {
      if (presetFalconBtn) presetFalconBtn.className = "pill-btn active";
      if (presetTortoiseBtn) presetTortoiseBtn.className = "pill-btn";
      if (presetReplayBtn) presetReplayBtn.className = "pill-btn";
      if (stratSelect) stratSelect.value = "0x46414c434f4e5f434f4d4d4954";
      if (unitsInput) unitsInput.value = "700";
      if (valAfterInput) valAfterInput.value = "1300";
      if (ddInput) ddInput.value = "0";
    });
  }

  if (presetReplayBtn) {
    presetReplayBtn.addEventListener("click", () => {
      if (presetReplayBtn) presetReplayBtn.className = "pill-btn active";
      if (presetTortoiseBtn) presetTortoiseBtn.className = "pill-btn";
      if (presetFalconBtn) presetFalconBtn.className = "pill-btn";
      if (stratSelect) stratSelect.value = "0x544f52544f4953455f434f4d4d4954";
      if (unitsInput) unitsInput.value = "350";
      if (valAfterInput) valAfterInput.value = "1120";
      if (ddInput) ddInput.value = "800";
    });
  }

  // 3. Submit Shielded Action Button
  const submitActionBtn = document.querySelector("#submit-shielded-action-btn");
  if (submitActionBtn) {
    submitActionBtn.addEventListener("click", async () => {
      const isReplay = presetReplayBtn && presetReplayBtn.classList.contains("active");
      const stratCommitment = stratSelect ? stratSelect.value : "0x544f52544f4953455f434f4d4d4954";
      const allocationUnits = Number(unitsInput?.value ?? 350);
      const portfolioValueAfter = Number(valAfterInput?.value ?? 1120);
      const drawdownBps = Number(ddInput?.value ?? 800);
      const receiptId = isReplay ? lastReceiptId : `0x${Buffer.from(`ACT_${Date.now()}`).toString("hex")}`;

      showTxProgress(
        "Submitting Shielded Action",
        `Executing privacy note \u2192 privacy_invoke \u2192 ArenaAdapter \u2192 Arena...`,
      );

      try {
        const res = await fetch("http://127.0.0.1:4174/api/devnet/submit-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyCommitment: stratCommitment,
            receiptId,
            allocationUnits,
            portfolioValueBefore: 1000,
            portfolioValueAfter,
            drawdownBps,
            role: getCurrentRole(),
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Action invocation reverted");
        }

        lastReceiptId = json.receiptId;
        const msg = json.accepted
          ? `Shielded action accepted on-chain. Portfolio updated to ${portfolioValueAfter}.`
          : `Shielded action rejected on-chain (Reason: ${json.reasonCode}). Portfolio remains unchanged.`;

        showTxSuccess("Shielded Action Executed", msg, {
          txHash: json.txHash,
          receiptId: json.receiptId,
          reasonCode: json.reasonCode,
          accepted: json.accepted,
        });

        await refreshDevnetState();
      } catch (err) {
        showTxError("Action Submission Failed", err.message);
      }
    });
  }

  // 4. Close Round Button (Sponsor Role)
  const closeBtn = document.querySelector("#stage-c-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      showTxProgress("Closing Round", "Advancing Devnet block time and calling Arena.close()...");
      try {
        const res = await fetch("http://127.0.0.1:4174/api/devnet/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: getCurrentRole(), advanceTime: true }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Close transaction reverted");
        }
        const winnerLabel = lookupStrategyLabel(json.winner);
        showTxSuccess("Arena Closed", `Round closed on-chain. Derived winner: ${winnerLabel} (${shorten(json.winner)}).`, {
          txHash: json.txHash,
        });
        await refreshDevnetState();
      } catch (err) {
        showTxError("Close Round Failed", err.message);
      }
    });
  }

  // 5. Settle Winner Button (Sponsor Role)
  const settleBtn = document.querySelector("#stage-c-settle-btn");
  const settleInput = document.querySelector("#settle-amount-input");
  if (settleBtn) {
    settleBtn.addEventListener("click", async () => {
      const amountUnits = Number(settleInput?.value ?? 100);
      showTxProgress("Settling Round", `Calling Arena.settle(${amountUnits} units)...`);
      try {
        const res = await fetch("http://127.0.0.1:4174/api/devnet/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountUnits, role: getCurrentRole() }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Settlement transaction reverted");
        }
        const winnerLabel = lookupStrategyLabel(json.winner);
        showTxSuccess("Round Settled", `Settlement completed on-chain! Winner: ${winnerLabel}, Payout: ${json.amountUnits} USD units.`, {
          txHash: json.txHash,
        });
        await refreshDevnetState();
      } catch (err) {
        showTxError("Settlement Failed", err.message);
      }
    });
  }
}

// ── Tab Management ────────────────────────────────────────────────────────────
function setupTabs() {
  const liveTabBtn = document.querySelector("#tab-live-btn");
  const caseStudyTabBtn = document.querySelector("#tab-case-study-btn");
  const liveView = document.querySelector("#view-live");
  const caseStudyView = document.querySelector("#view-case-study");

  if (liveTabBtn && caseStudyTabBtn) {
    liveTabBtn.addEventListener("click", () => {
      currentTab = "live";
      liveTabBtn.classList.add("active");
      caseStudyTabBtn.classList.remove("active");
      if (liveView) liveView.style.display = "block";
      if (caseStudyView) caseStudyView.style.display = "none";
    });

    caseStudyTabBtn.addEventListener("click", () => {
      currentTab = "case-study";
      caseStudyTabBtn.classList.add("active");
      liveTabBtn.classList.remove("active");
      if (liveView) liveView.style.display = "none";
      if (caseStudyView) caseStudyView.style.display = "block";
      renderCaseStudyView();
    });
  }
}

// ── Case Study Loader (Deterministic Reference Specification) ─────────────────
async function loadCaseStudyFixture() {
  try {
    const res = await fetch("case-study.json");
    if (res.ok) {
      caseStudyData = await res.json();
    }
  } catch (err) {
    console.error("Failed to load case-study.json:", err);
  }
}

function renderCaseStudyView() {
  if (!caseStudyData) return;

  // Render Case Study Rules
  const rulesGrid = document.querySelector("#case-study-rules-grid");
  if (rulesGrid && caseStudyData.rules) {
    rulesGrid.innerHTML = [
      ["Starting Units", `${caseStudyData.rules.startingUnits.toLocaleString()} units`],
      ["Max Allocation", formatBps(caseStudyData.rules.maxAllocationBps)],
      ["Max Drawdown", formatBps(caseStudyData.rules.maxDrawdownBps)],
      ["Prize Cap", `${caseStudyData.rules.prizeCapUnits ?? 100} units`],
      ["Allowed Asset", caseStudyData.rules.allowedAssets.join(", ")],
      ["Target", caseStudyData.rules.allowedTargets.join(", ")],
    ].map(([label, val]) => `<div class="mini-rule-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(val)}</strong></div>`).join("");
  }

  // Render Case Study Leaderboard
  const leaderboardEl = document.querySelector("#case-study-leaderboard");
  if (leaderboardEl && caseStudyData.leaderboard) {
    leaderboardEl.innerHTML = caseStudyData.leaderboard.map((entry, index) => {
      const isWinner = index === 0 && entry.eligible;
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
            <span class="result ${isWinner ? "winner" : (entry.eligible ? "eligible" : "disqualified")}">
              ${isWinner ? "WINNER" : (entry.eligible ? "ELIGIBLE" : "DISQUALIFIED")}
            </span>
          </div>
        </div>
      `;
    }).join("");
  }

  // Render Case Study Feed
  const feedEl = document.querySelector("#case-study-feed");
  if (feedEl && caseStudyData.evidence && caseStudyData.evidence.actionReceipts) {
    feedEl.innerHTML = caseStudyData.evidence.actionReceipts.map((receipt) => `
      <div class="feed-row">
        <span class="feed-status ${receipt.accepted ? "accepted" : "rejected"}">${receipt.accepted ? "\u2713" : "\u2715"}</span>
        <div>
          <strong>${escapeHtml(receipt.receiptId)} &middot; ${receipt.accepted ? "ACCEPTED" : "REJECTED"}</strong>
          <span>${escapeHtml(receipt.note ?? receipt.reasonCode)}</span>
          <small>Strategy: ${escapeHtml(shorten(receipt.strategyCommitment))}</small>
        </div>
        <time>${receipt.timestamp ? new Date(receipt.timestamp).toLocaleTimeString() : "T+Round"}</time>
      </div>
    `).join("");
  }
}

// ── Live Devnet Session Reader ────────────────────────────────────────────────
async function refreshDevnetState() {
  const topbarBadge = document.querySelector("#topbar-network-badge");
  const disBanner = document.querySelector("#disconnected-banner");
  const arenaAddrEl = document.querySelector("#env-arena-address");
  const blockNumberEl = document.querySelector("#env-block-number");
  const rpcUrlEl = document.querySelector("#env-rpc-url");
  const adapterStatusEl = document.querySelector("#env-adapter-status");
  const roundStatusEl = document.querySelector("#live-round-status");

  try {
    // Attempt to reach localhost session service
    const sessionRes = await fetch("http://127.0.0.1:4174/api/devnet/session", { cache: "no-store" });
    if (!sessionRes.ok) throw new Error("Session service returned non-200");

    sessionData = await sessionRes.json();

    if (sessionData.status === "active") {
      if (topbarBadge) {
        topbarBadge.className = "network devnet";
        topbarBadge.innerHTML = `<i></i> Devnet Active`;
      }
      if (disBanner) disBanner.style.display = "none";

      if (arenaAddrEl) arenaAddrEl.textContent = shorten(sessionData.addresses.arenaAddress);
      if (blockNumberEl) blockNumberEl.textContent = `#${sessionData.blockNumber}`;
      if (rpcUrlEl) rpcUrlEl.textContent = sessionData.rpcUrl.replace("http://", "");
      if (adapterStatusEl) {
        adapterStatusEl.textContent = sessionData.adapterLocked ? "Locked" : "Unlocked";
        adapterStatusEl.className = `status-badge ${sessionData.adapterLocked ? "locked" : "live"}`;
      }

      if (roundStatusEl) {
        if (sessionData.settled) {
          roundStatusEl.textContent = "Settled";
          roundStatusEl.className = "status-badge settled";
        } else if (sessionData.closed) {
          roundStatusEl.textContent = "Closed (Winner Derived)";
          roundStatusEl.className = "status-badge locked";
        } else {
          roundStatusEl.textContent = "Active";
          roundStatusEl.className = "status-badge live";
        }
      }

      renderSettlementBanner(sessionData);
      renderLiveContractAddresses(sessionData);
      renderLiveRegisteredStrategies(sessionData);
      renderRoundParams(sessionData);
      applyNetworkLabels("devnet");
      await fetchAndRenderOnChainRulesAndAdapter(sessionData);
      await fetchAndRenderOnChainScores(sessionData);
      await fetchAndRenderLiveEvidence();
      return;
    }
  } catch {
    // Session service offline — try public RPC fallback (Sepolia/mainnet) before showing offline
    const cfg = getPublicConfig();
    if (cfg.hasPublicConfig && cfg.rpcUrl && cfg.arenaAddress) {
      publicConfig = cfg;
      try {
        await refreshPublicState();
        return;
      } catch {
        // fall through to offline if public also fails
      }
    }
  }

  // If devnet active check did not return and public fallback not taken or failed, check explicit public mode request
  const explicitCfg = getPublicConfig();
  if (explicitCfg.hasPublicConfig && explicitCfg.rpcUrl && explicitCfg.arenaAddress) {
    publicConfig = explicitCfg;
    try {
      await refreshPublicState();
      return;
    } catch {
      // fall through
    }
  }

  // Handle Disconnected State
  const offlineState = renderDisconnectedState();
  if (topbarBadge) {
    topbarBadge.className = offlineState.topbarClass;
    topbarBadge.innerHTML = offlineState.topbarText;
  }
  if (disBanner) disBanner.style.display = offlineState.bannerDisplay;
  if (arenaAddrEl) arenaAddrEl.textContent = offlineState.arenaAddress;
  if (blockNumberEl) blockNumberEl.textContent = offlineState.blockNumber;
  if (rpcUrlEl) rpcUrlEl.textContent = offlineState.rpcUrl;

  const liveLeaderboard = document.querySelector("#live-leaderboard");
  if (liveLeaderboard) {
    liveLeaderboard.innerHTML = offlineState.leaderboardHtml;
  }

  const liveFeed = document.querySelector("#live-feed");
  if (liveFeed) {
    liveFeed.innerHTML = offlineState.feedHtml;
  }
  publicModeActive = false;
  // When offline, surface public-RPC config hint so judges can instantly switch to Sepolia B1 demo
  try {
    const cfg2 = getPublicConfig();
    const form2 = document.querySelector("#public-rpc-config-form");
    if (form2) {
      if (!cfg2.hasPublicConfig) {
        form2.style.display = "flex";
        // Add hint link if not present
        let hint = document.querySelector("#public-hint-row");
        if (!hint) {
          hint = document.createElement("div");
          hint.id = "public-hint-row";
          hint.style.cssText = "margin-top:8px;font-size:12px;opacity:0.85";
          const dis = document.querySelector("#disconnected-banner");
          if (dis) dis.appendChild(hint);
        }
        if (hint) hint.innerHTML = `Devnet offline — <a href="?network=sepolia&arena=${SEPOLIA_B1_DEFAULTS.arenaAddress}&rpcUrl=${encodeURIComponent(SEPOLIA_B1_DEFAULTS.rpcHint)}" style="color:#6ea8fe">view B1 Sepolia demo (public RPC)</a> or configure above.`;
      } else if (cfg2.rpcUrl && cfg2.arenaAddress) {
        // Had config but RPC failed — show error and keep form open
        form2.style.display = "flex";
        const hint = document.querySelector("#public-hint-row");
        if (hint) hint.textContent = `Public RPC failed — check RPC URL and arena address, then Save & Connect.`;
      }
    }
    if (topbarBadge && cfg2.hasPublicConfig) {
      topbarBadge.innerHTML = `<i></i> Public RPC unreachable`;
      topbarBadge.className = "network disconnected";
    }
  } catch {}
}

// ── Public-RPC Mode (Sepolia / Mainnet) ─────────────────────────────────────

function setupPublicRpcControls() {
  const cfg = getPublicConfig();
  // Auto-create minimal config form if missing (injected into disconnected banner)
  let form = document.querySelector("#public-rpc-config-form");
  if (!form) {
    const banner = document.querySelector("#disconnected-banner");
    if (banner) {
      form = document.createElement("div");
      form.id = "public-rpc-config-form";
      form.style.cssText = "margin-top:12px;padding:12px;border:1px solid #2a2a3a;background:#0f0f14;border-radius:8px;display:none;flex-direction:column;gap:8px;max-width:520px;";
      form.innerHTML = `
        <strong style="font-size:13px">Public RPC — Sepolia / Mainnet</strong>
        <small style="opacity:0.7">When devnet is offline, append <code>?network=sepolia&arena=0x...&rpcUrl=https://...</code> or fill below and Save. Defaults to B1 Sepolia demo (0x52d02e...).</small>
        <label style="font-size:12px">RPC URL <input id="public-rpc-url-input" placeholder="https://starknet-sepolia-rpc.publicnode.com" style="width:100%;margin-top:4px;padding:6px;border-radius:4px;border:1px solid #333;background:#111;color:#ddd"/></label>
        <label style="font-size:12px">Arena Address <input id="public-arena-input" placeholder="0x52d02e52b71de8bc53efa87b723b9eb53e53b1d08dbf7eb103a9d8d55744f51" style="width:100%;margin-top:4px;padding:6px;border-radius:4px;border:1px solid #333;background:#111;color:#ddd"/></label>
        <label style="font-size:12px">Adapter Address (optional) <input id="public-adapter-input" placeholder="0x42cfafc785c1abeb076c34bcad1e1f698a4e9cf8488a8fbb0ae783acec18c20" style="width:100%;margin-top:4px;padding:6px;border-radius:4px;border:1px solid #333;background:#111;color:#ddd"/></label>
        <div style="display:flex;gap:8px">
          <button id="public-save-btn" class="pill-btn" style="flex:0">Save & Connect</button>
          <button id="public-clear-btn" class="pill-btn" style="flex:0">Clear</button>
          <button id="public-demo-btn" class="pill-btn" style="flex:0">Load B1 Demo</button>
        </div>
        <small style="opacity:0.6">Saved to localStorage bb:rpcUrl / bb:arenaAddress / bb:adapterAddress. Use <code>&rpcUrl=</code> query param to override without saving.</small>`;
      banner.appendChild(form);
    }
  }
  const urlInput = document.querySelector("#public-rpc-url-input");
  const arenaInput = document.querySelector("#public-arena-input");
  const adapterInput = document.querySelector("#public-adapter-input");
  const saveBtn = document.querySelector("#public-save-btn");
  const clearBtn = document.querySelector("#public-clear-btn");
  const demoBtn = document.querySelector("#public-demo-btn");
  const toggleBtn = document.querySelector("#public-config-toggle");
  if (urlInput) urlInput.value = cfg.rpcUrl || "";
  if (arenaInput) arenaInput.value = cfg.arenaAddress || "";
  if (adapterInput) adapterInput.value = cfg.adapterAddress || "";
  const toggle = () => {
    if (!form) return;
    form.style.display = form.style.display === "none" || !form.style.display ? "flex" : "none";
  };
  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.dataset.bound = "1";
    toggleBtn.addEventListener("click", toggle);
  }
  // Also bind click on disconnected banner title to toggle form when public hint shown
  const banner = document.querySelector("#disconnected-banner");
  if (banner && !banner.dataset.publicBound) {
    banner.dataset.publicBound = "1";
    banner.addEventListener("click", (e) => {
      if (e.target.closest("#public-rpc-config-form") || e.target.closest("button") || e.target.closest("a")) return;
      // allow toggling when offline
      const fb = document.querySelector("#public-rpc-config-form");
      if (fb && getPublicConfig().hasPublicConfig === false) toggle();
    });
  }
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", () => {
      try {
        if (urlInput?.value.trim()) localStorage.setItem("bb:rpcUrl", urlInput.value.trim());
        else localStorage.removeItem("bb:rpcUrl");
        if (arenaInput?.value.trim()) localStorage.setItem("bb:arenaAddress", arenaInput.value.trim());
        else localStorage.removeItem("bb:arenaAddress");
        if (adapterInput?.value.trim()) localStorage.setItem("bb:adapterAddress", adapterInput.value.trim());
        else localStorage.removeItem("bb:adapterAddress");
        localStorage.setItem("bb:network", "sepolia");
      } catch {}
      publicConfig = getPublicConfig();
      refreshPublicState();
    });
  }
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem("bb:rpcUrl");
        localStorage.removeItem("bb:arenaAddress");
        localStorage.removeItem("bb:adapterAddress");
        localStorage.removeItem("bb:network");
      } catch {}
      if (urlInput) urlInput.value = "";
      if (arenaInput) arenaInput.value = "";
      if (adapterInput) adapterInput.value = "";
      publicConfig = getPublicConfig();
      publicModeActive = false;
      refreshDevnetState();
    });
  }
  if (demoBtn && !demoBtn.dataset.bound) {
    demoBtn.dataset.bound = "1";
    demoBtn.addEventListener("click", () => {
      if (urlInput) urlInput.value = SEPOLIA_B1_DEFAULTS.rpcHint;
      if (arenaInput) arenaInput.value = SEPOLIA_B1_DEFAULTS.arenaAddress;
      if (adapterInput) adapterInput.value = SEPOLIA_B1_DEFAULTS.adapterAddress;
    });
  }
}

async function refreshPublicState() {
  const cfg = publicConfig || getPublicConfig();
  publicConfig = cfg;
  if (!cfg.rpcUrl || !cfg.arenaAddress) {
    publicModeActive = false;
    throw new Error("Public RPC not configured");
  }
  publicModeActive = true;
  const topbarBadge = document.querySelector("#topbar-network-badge");
  const disBanner = document.querySelector("#disconnected-banner");
  const arenaAddrEl = document.querySelector("#env-arena-address");
  const blockNumberEl = document.querySelector("#env-block-number");
  const rpcUrlEl = document.querySelector("#env-rpc-url");
  const adapterStatusEl = document.querySelector("#env-adapter-status");
  const roundStatusEl = document.querySelector("#live-round-status");
  if (topbarBadge) {
    const label = cfg.network === "mainnet" ? "Mainnet \u00b7 Public" : "Sepolia \u00b7 Public";
    topbarBadge.className = "network live";
    topbarBadge.innerHTML = `<i></i> ${label}`;
  }
  if (disBanner) disBanner.style.display = "none";
  if (arenaAddrEl) {
    arenaAddrEl.textContent = shorten(cfg.arenaAddress);
    arenaAddrEl.title = cfg.arenaAddress;
  }
  if (rpcUrlEl) {
    try {
      rpcUrlEl.textContent = new URL(cfg.rpcUrl).hostname;
      rpcUrlEl.title = cfg.rpcUrl;
    } catch {
      rpcUrlEl.textContent = shorten(cfg.rpcUrl);
    }
  }
  if (blockNumberEl) blockNumberEl.textContent = "#public";
  // Fetch block number for display (best-effort)
  try {
    const blk = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "starknet_blockNumber", params: [] }),
    }).then((r) => r.json());
    if (blk && typeof blk.result === "number" && blockNumberEl) blockNumberEl.textContent = `#${blk.result}`;
  } catch {}
  // Adapter + rules
  await fetchAndRenderPublicOnChainMeta(cfg, adapterStatusEl);
  await fetchAndRenderPublicScores(cfg);
  await fetchAndRenderPublicAttested(cfg);
  await fetchAndRenderPublicSettlement(cfg, roundStatusEl);
  renderPublicTopMeta(cfg);
  // Config form is hidden when connected
  const form = document.querySelector("#public-rpc-config-form");
  if (form) form.style.display = "none";
}

function renderPublicTopMeta(cfg) {
  const metaEl = document.querySelector("#public-meta-row");
  let el = metaEl;
  if (!el) {
    const anchor = document.querySelector("#env-arena-address")?.parentElement;
    if (anchor && anchor.parentElement) {
      el = document.createElement("div");
      el.id = "public-meta-row";
      el.style.cssText = "margin:8px 0;font-size:12px;opacity:0.85";
      anchor.parentElement.appendChild(el);
    }
  }
  if (el) el.innerHTML = renderPublicStatusHtml(cfg, null);
}

async function fetchAndRenderPublicOnChainMeta(cfg, adapterStatusEl) {
  const rulesEl = document.querySelector("#live-rules-commit");
  const adapterEl = document.querySelector("#live-adapter-addr");
  try {
    const r = await starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.rules_commitment, []);
    if (r.result && r.result.length > 0 && rulesEl) {
      rulesEl.textContent = r.result[0];
      rulesEl.title = `On-chain rules commitment: ${r.result[0]}`;
    }
  } catch {
    if (rulesEl) rulesEl.textContent = "Error reading rules";
  }
  try {
    const a = await starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_action_adapter, []);
    if (a.result && a.result.length > 0) {
      const addr = a.result[0];
      if (adapterEl) {
        adapterEl.textContent = shorten(addr);
        adapterEl.title = `On-chain action adapter: ${addr}`;
      }
      if (adapterStatusEl) {
        const locked = addr && BigInt(addr) !== 0n;
        adapterStatusEl.textContent = locked ? "Locked" : "Unlocked";
        adapterStatusEl.className = `status-badge ${locked ? "locked" : "live"}`;
      }
    }
  } catch {
    if (adapterStatusEl) adapterStatusEl.textContent = "Unknown";
  }
  // Float token
  try {
    const ft = await starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_float_token, []);
    const parsed = parseFloatTokenResult(ft);
    const ftEl = document.querySelector("#live-float-token");
    let host = ftEl;
    if (!host) {
      const anchor = document.querySelector("#live-registered-list")?.parentElement;
      if (anchor) {
        host = document.createElement("div");
        host.id = "live-float-token";
        host.style.cssText = "margin:8px 0;font-size:12px";
        anchor.appendChild(host);
      }
    }
    if (host) {
      host.textContent = parsed.ok ? `Float token: ${shorten(parsed.token)}` : `Float token: ${parsed.error}`;
      if (parsed.ok) host.title = parsed.token;
    }
  } catch {}
}

async function fetchAndRenderPublicScores(cfg) {
  const leaderboardEl = document.querySelector("#live-leaderboard");
  if (!leaderboardEl) return;
  const list = cfg.arenaAddress.toLowerCase() === SEPOLIA_B1_DEFAULTS.arenaAddress.toLowerCase() ? SEPOLIA_B1_STRATEGIES : STRATEGIES;
  const scores = await Promise.all(
    list.map(async (strat) => {
      try {
        const json = await starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_score, [strat.commitment]);
        return parseScoreEntry(json, strat);
      } catch {
        return { label: strat.label, commitment: strat.commitment, error: true, errorReason: "RPC connection failed" };
      }
    }),
  );
  leaderboardEl.innerHTML = renderLeaderboardHtml(scores);
}

async function fetchAndRenderPublicAttested(cfg) {
  let container = document.querySelector("#live-attested-float");
  if (!container) {
    const anchor = document.querySelector("#live-leaderboard")?.parentElement;
    if (anchor) {
      container = document.createElement("div");
      container.id = "live-attested-float";
      container.style.cssText = "margin:12px 0;padding:10px;border:1px solid #222;border-radius:8px;background:#0a0a0f";
      const title = document.createElement("div");
      title.style.cssText = "font-size:13px;font-weight:600;margin-bottom:8px";
      title.textContent = "Attested Float Snapshots (Option B) — live balance_of + checkpoints";
      container.appendChild(title);
      const body = document.createElement("div");
      body.id = "live-attested-float-body";
      container.appendChild(body);
      // Insert after leaderboard
      const lb = document.querySelector("#live-leaderboard");
      if (lb && lb.parentElement) lb.parentElement.insertBefore(container, lb.nextSibling);
      else anchor.appendChild(container);
      container = body;
    }
  } else if (container.querySelector("#live-attested-float-body")) {
    container = container.querySelector("#live-attested-float-body");
  }
  if (!container) return;
  const list2 = cfg.arenaAddress.toLowerCase() === SEPOLIA_B1_DEFAULTS.arenaAddress.toLowerCase() ? SEPOLIA_B1_STRATEGIES : STRATEGIES;
  const entries = await Promise.all(
    list2.map(async (strat) => {
      try {
        const [sRes, pRes, dRes, cRes] = await Promise.all([
          starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_attest_start, [strat.commitment]),
          starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_attest_peak, [strat.commitment]),
          starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_attest_max_dd, [strat.commitment]),
          starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_checkpoint_count, [strat.commitment]),
        ]);
        const s = parseAttestStartResult(sRes);
        const p = parseAttestPeakResult(pRes);
        const d = parseAttestMaxDdResult(dRes);
        const c = parseCheckpointCountResult(cRes);
        let lastBal = null;
        if (c.ok && c.count > 0) {
          const lastIdx = String(c.count - 1);
          const cp = await starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_checkpoint, [strat.commitment, lastIdx]);
          const parsed = parseCheckpointResult(cp);
          if (parsed.ok) lastBal = parsed.balanceRaw;
        }
        if (!s.ok && !p.ok && !d.ok && !c.ok) return { label: strat.label, commitment: strat.commitment, error: "No attested float for this commitment" };
        return {
          label: strat.label,
          commitment: strat.commitment,
          start: s.ok ? s.raw : null,
          peak: p.ok ? p.raw : null,
          maxDdBps: d.ok ? d.bps : null,
          checkpoints: c.ok ? c.count : null,
          lastCheckpointBalance: lastBal,
        };
      } catch (e) {
        return { label: strat.label, commitment: strat.commitment, error: String(e?.message || e) };
      }
    }),
  );
  container.innerHTML = renderAttestedFloatHtml(entries);
}

async function fetchAndRenderPublicSettlement(cfg, roundStatusEl) {
  try {
    const [winnerRes, settleRes] = await Promise.all([
      starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_winner, []),
      starknetCall(cfg.rpcUrl, cfg.arenaAddress, SELECTORS.get_settlement, []),
    ]);
    let winner = "0x0";
    let settled = false;
    let amountUnits = 0;
    if (winnerRes && Array.isArray(winnerRes.result) && winnerRes.result.length > 0) {
      winner = winnerRes.result[0];
      settled = winner && BigInt(winner) !== 0n;
    }
    const parsedSet = parseSettlementEntry(settleRes);
    if (parsedSet.settled) {
      settled = true;
      winner = parsedSet.winner;
      amountUnits = parsedSet.amountUnits;
    }
    if (roundStatusEl) {
      if (settled) {
        roundStatusEl.textContent = "Settled";
        roundStatusEl.className = "status-badge settled";
      } else if (winner && BigInt(winner) !== 0n) {
        roundStatusEl.textContent = "Closed (Winner Derived)";
        roundStatusEl.className = "status-badge locked";
      } else {
        roundStatusEl.textContent = "Active";
        roundStatusEl.className = "status-badge live";
      }
    }
    // Reuse settlement banner helper with synthetic session shape
    renderSettlementBanner({ settled, closed: settled || (winner && BigInt(winner) !== 0n), winner, settlementAmount: amountUnits });
  } catch {}
  // Evidence feed note for public mode
  const feedEl = document.querySelector("#live-feed");
  if (feedEl && !feedEl.dataset.publicNote) {
    feedEl.dataset.publicNote = "1";
    const note = document.createElement("div");
    note.style.cssText = "font-size:11px;opacity:0.6;margin-bottom:6px";
    note.textContent = "Public RPC: evidence receipts are session-local. On-chain contract reads above are authoritative.";
    feedEl.parentElement?.insertBefore(note, feedEl);
  }
}

function renderSettlementBanner(session) {
  const banner = document.querySelector("#live-settlement-banner");
  const tag = document.querySelector("#settlement-status-tag");
  const label = document.querySelector("#settlement-winner-label");
  const payout = document.querySelector("#settlement-payout-text");

  if (!banner) return;

  if (session.settled) {
    banner.style.display = "flex";
    if (tag) tag.textContent = "ROUND SETTLED";
    if (label) label.textContent = `Winner: ${lookupStrategyLabel(session.winner)}`;
    if (payout) payout.innerHTML = `Contract-verified settlement payout: <strong>${session.settlementAmount} USD units</strong>`;
  } else if (session.closed) {
    banner.style.display = "flex";
    if (tag) tag.textContent = "ROUND CLOSED";
    if (label) label.textContent = `Derived Winner: ${lookupStrategyLabel(session.winner)}`;
    if (payout) payout.innerHTML = `Ready for sponsor settlement (Prize cap: 100 units)`;
  } else {
    banner.style.display = "none";
  }
}

function renderLiveContractAddresses(session) {
  const addrMap = {
    "#live-arena-addr": session.addresses.arenaAddress,
    "#live-adapter-addr": session.addresses.adapterAddress,
    "#live-privacy-addr": session.addresses.privacyPoolAddress,
    "#live-usd-addr": session.addresses.usdTokenAddress,
  };

  for (const [selector, address] of Object.entries(addrMap)) {
    const el = document.querySelector(selector);
    if (el) {
      el.textContent = shorten(address);
      el.title = address;
    }
  }
}

function renderLiveRegisteredStrategies(session) {
  const listEl = document.querySelector("#live-registered-list");
  if (!listEl) return;

  listEl.innerHTML = STRATEGIES.map((s, idx) => {
    const registrant = session.strategyRegistrants?.[s.commitment];
    const registrantHtml = registrant
      ? `<code class="registrant-chip" title="On-chain registrant (prize recipient): ${escapeHtml(registrant)}">op: ${escapeHtml(shorten(registrant))}</code>`
      : "";
    return `
    <div class="reg-item">
      <span><strong>${escapeHtml(s.label)}</strong> (Order #${idx + 1}) ${registrantHtml}</span>
      <code>${escapeHtml(shorten(s.commitment))}</code>
    </div>
  `;
  }).join("");
}

// ── On-Chain Contract Reads: rules_commitment and get_action_adapter ──────────
async function fetchAndRenderOnChainRulesAndAdapter(session) {
  const rulesEl = document.querySelector("#live-rules-commit");
  const adapterEl = document.querySelector("#live-adapter-addr");

  try {
    const rulesRes = await fetch(session.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "starknet_call",
        params: [
          {
            contract_address: session.addresses.arenaAddress,
            entry_point_selector: SELECTORS.rules_commitment,
            calldata: [],
          },
          "latest",
        ],
      }),
    });
    const rulesJson = await rulesRes.json();
    if (rulesJson.result && rulesJson.result.length > 0 && rulesEl) {
      rulesEl.textContent = rulesJson.result[0];
      rulesEl.title = `On-chain rules commitment: ${rulesJson.result[0]}`;
    }
  } catch (err) {
    if (rulesEl) rulesEl.textContent = "Error reading rules";
  }

  try {
    const adapterRes = await fetch(session.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "starknet_call",
        params: [
          {
            contract_address: session.addresses.arenaAddress,
            entry_point_selector: SELECTORS.get_action_adapter,
            calldata: [],
          },
          "latest",
        ],
      }),
    });
    const adapterJson = await adapterRes.json();
    if (adapterJson.result && adapterJson.result.length > 0 && adapterEl) {
      adapterEl.textContent = shorten(adapterJson.result[0]);
      adapterEl.title = `On-chain action adapter: ${adapterJson.result[0]}`;
    }
  } catch (err) {
    if (adapterEl) adapterEl.textContent = "Error reading adapter";
  }
}

// ── Direct JSON-RPC Contract Call: get_score (NO FABRICATED FALLBACKS) ─────────
async function fetchAndRenderOnChainScores(session) {
  const leaderboardEl = document.querySelector("#live-leaderboard");
  if (!leaderboardEl) return;

  const scorePromises = STRATEGIES.map(async (strat) => {
    try {
      const rpcBody = {
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: [
          {
            contract_address: session.addresses.arenaAddress,
            entry_point_selector: SELECTORS.get_score,
            calldata: [strat.commitment],
          },
          "latest",
        ],
      };

      const res = await fetch(session.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rpcBody),
      });

      const json = await res.json();
      return parseScoreEntry(json, strat);
    } catch (err) {
      return {
        label: strat.label,
        commitment: strat.commitment,
        error: true,
        errorReason: "RPC connection failed",
      };
    }
  });

  const scores = await Promise.all(scorePromises);
  leaderboardEl.innerHTML = renderLeaderboardHtml(scores);
}

// ── Round Parameters & Local Rules Verification ───────────────────────────────
function renderRoundParams(session) {
  const pre = document.querySelector("#rules-params-json");
  if (!pre) return;
  const params = session.roundParams;
  if (!params) {
    pre.textContent = "{}";
    return;
  }
  const canonical = buildCanonicalRulesJson(params);
  pre.textContent = canonical.ok ? canonical.json : "{}";
}

function applyNetworkLabels(network) {
  const label = networkLabelFor(network);
  document.querySelectorAll("[data-network-label]").forEach((el) => {
    el.textContent = label.text;
  });
  const footerStatus = document.querySelector("#footer-status-text");
  if (footerStatus) footerStatus.textContent = `${label.text} INTEGRATION \u00B7 CONTRACT-VERIFIED STATE`;
}

async function exportEvidenceJson() {
  try {
    const res = await fetch("http://127.0.0.1:4174/api/devnet/evidence", { cache: "no-store" });
    const data = res.ok ? await res.json() : { receipts: [] };
    const payload = buildEvidenceExportPayload(data.receipts, {
      network: "devnet",
      arenaAddress: sessionData?.addresses?.arenaAddress ?? null,
      rulesCommitment: sessionData?.rulesCommitment ?? null,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `blackbox-evidence-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showTxSuccess("Evidence Exported", "Current-session receipts downloaded as JSON.");
  } catch (err) {
    showTxError("Export Failed", err?.message ?? "Could not export evidence.");
  }
}

// ── Live Current-Session Evidence Feed (NO INVENTED / FABRICATED ROWS) ─────────
async function fetchAndRenderLiveEvidence() {
  const feedEl = document.querySelector("#live-feed");
  if (!feedEl) return;

  try {
    const res = await fetch("http://127.0.0.1:4174/api/devnet/evidence", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      feedEl.innerHTML = renderLiveEvidenceFeedHtml(
        data.receipts,
        "devnet",
        sessionData?.rpcUrl ?? "",
      );
      return;
    }
  } catch {
    // ignore
  }

  feedEl.innerHTML = renderLiveEvidenceFeedHtml([]);
}
