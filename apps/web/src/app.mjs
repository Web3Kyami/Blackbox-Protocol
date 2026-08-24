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
} from "./dashboard-model.mjs";

let sessionData = null;
let caseStudyData = null;
let currentTab = "live"; // "live" | "case-study"
let lastReceiptId = "0x544f52544f4953455f4f4b"; // default replay candidate
let wallet = { provider: null, address: null, name: null };

// ── Lifecycle Initialization ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupStageCControls();
  setupWalletControls();
  await loadCaseStudyFixture();
  await refreshDevnetState();

  const refreshBtn = document.querySelector("#refresh-devnet-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshDevnetState();
    });
  }

  const exportBtn = document.querySelector("#export-evidence-btn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportEvidenceJson);
  }

  // Periodic polling for live session state
  setInterval(refreshDevnetState, 8000);
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
      if (!sessionData || sessionData.status !== "active") {
        showTxError("Join Failed", "Devnet session is offline. Start the local session service first.");
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
        call = buildRegisterStrategyCall(sessionData.addresses.arenaAddress, normalized.value);
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
        await refreshDevnetState();
      } catch (err) {
        showTxError("Registration Failed", mapWalletError(err));
      }
    });
  }
}

async function verifyRegistrantBinding(commitment, txHash) {
  if (!sessionData) return null;
  try {
    const res = await fetch(sessionData.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "starknet_call",
        params: [
          {
            contract_address: sessionData.addresses.arenaAddress,
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
    // Session service offline
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
