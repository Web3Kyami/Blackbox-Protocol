import { createHash } from "node:crypto";

export const ArenaStatus = Object.freeze({
  REGISTRATION: "REGISTRATION",
  LIVE: "LIVE",
  CLOSED: "CLOSED",
  SETTLED: "SETTLED",
});

export const RejectionCode = Object.freeze({
  UNREGISTERED_STRATEGY: "UNREGISTERED_STRATEGY",
  ACTION_BEFORE_START: "ACTION_BEFORE_START",
  ACTION_AFTER_CLOSE: "ACTION_AFTER_CLOSE",
  DUPLICATE_RECEIPT: "DUPLICATE_RECEIPT",
  UNSUPPORTED_ASSET: "UNSUPPORTED_ASSET",
  UNAUTHORIZED_TARGET: "UNAUTHORIZED_TARGET",
  ALLOCATION_EXCEEDED: "ALLOCATION_EXCEEDED",
  MALFORMED_ACTION: "MALFORMED_ACTION",
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function commitRules(rules) {
  return `0x${createHash("sha256").update(canonicalize(rules)).digest("hex")}`;
}

export function calculateReturnBps(startingValue, finalValue) {
  invariant(Number.isSafeInteger(startingValue) && startingValue > 0, "starting value must be a positive safe integer");
  invariant(Number.isSafeInteger(finalValue) && finalValue >= 0, "final value must be a non-negative safe integer");
  return Math.trunc(((finalValue - startingValue) * 10_000) / startingValue);
}

function validateRules(rules) {
  invariant(rules && typeof rules === "object", "rules are required");
  invariant(Number.isSafeInteger(rules.startTime) && Number.isSafeInteger(rules.endTime), "times must be integer unix seconds");
  invariant(rules.startTime < rules.endTime, "start time must be before end time");
  invariant(Number.isSafeInteger(rules.startingUnits) && rules.startingUnits > 0, "starting units must be positive");
  invariant(Number.isSafeInteger(rules.maxAllocationBps) && rules.maxAllocationBps > 0 && rules.maxAllocationBps <= 10_000, "allocation limit must be 1..10000 bps");
  invariant(Number.isSafeInteger(rules.maxDrawdownBps) && rules.maxDrawdownBps >= 0 && rules.maxDrawdownBps <= 10_000, "drawdown limit must be 0..10000 bps");
  invariant(Number.isSafeInteger(rules.prizeCapUnits) && rules.prizeCapUnits >= 0, "prize cap must be non-negative");
  invariant(Array.isArray(rules.allowedAssets) && rules.allowedAssets.length > 0, "asset allowlist cannot be empty");
  invariant(Array.isArray(rules.allowedTargets) && rules.allowedTargets.length > 0, "target allowlist cannot be empty");
  invariant(new Set(rules.allowedAssets).size === rules.allowedAssets.length, "asset allowlist contains duplicates");
  invariant(new Set(rules.allowedTargets).size === rules.allowedTargets.length, "target allowlist contains duplicates");
}

function cloneRules(rules) {
  return Object.freeze({
    ...rules,
    allowedAssets: Object.freeze([...rules.allowedAssets]),
    allowedTargets: Object.freeze([...rules.allowedTargets]),
    scoringPolicy: "RETURN_BPS_MINUS_MAX_DRAWDOWN_BPS",
    rounding: "INTEGER_DIVISION_TRUNCATES_TOWARD_ZERO",
  });
}

export class Arena {
  #strategies = new Map();
  #receipts = new Set();
  #evidence = [];
  #registrationSequence = 0;
  #settlement = null;

  constructor({ id, sponsor, rules, createdAt }) {
    invariant(typeof id === "string" && id.length > 0, "arena id is required");
    invariant(typeof sponsor === "string" && sponsor.length > 0, "sponsor is required");
    invariant(Number.isSafeInteger(createdAt), "createdAt must be integer unix seconds");
    validateRules(rules);
    invariant(createdAt < rules.startTime, "arena must be created before start");
    this.id = id;
    this.sponsor = sponsor;
    this.rules = cloneRules(rules);
    this.rulesCommitment = commitRules(this.rules);
    this.createdAt = createdAt;
    this.closedAt = null;
  }

  statusAt(now) {
    if (this.#settlement) return ArenaStatus.SETTLED;
    if (this.closedAt !== null || now > this.rules.endTime) return ArenaStatus.CLOSED;
    if (now < this.rules.startTime) return ArenaStatus.REGISTRATION;
    return ArenaStatus.LIVE;
  }

  assertRulesCommitment() {
    invariant(commitRules(this.rules) === this.rulesCommitment, "rules commitment mismatch");
    return true;
  }

  registerStrategy({ commitment, label, registeredAt }) {
    invariant(Number.isSafeInteger(registeredAt), "registeredAt must be integer unix seconds");
    invariant(registeredAt < this.rules.startTime, "registration is closed");
    invariant(typeof commitment === "string" && /^0x[0-9a-f]{64}$/i.test(commitment), "commitment must be a 32-byte hex value");
    invariant(!this.#strategies.has(commitment), "duplicate strategy registration");
    invariant(typeof label === "string" && label.length > 0, "public label is required");
    this.#registrationSequence += 1;
    this.#strategies.set(commitment, {
      commitment,
      label,
      registeredAt,
      registrationOrder: this.#registrationSequence,
      currentValue: this.rules.startingUnits,
      maxDrawdownBps: 0,
      acceptedActions: 0,
      rejectedActions: 0,
    });
  }

  submitAction(action) {
    const rejection = this.#validateAction(action);
    const known = this.#strategies.get(action?.strategyCommitment);
    if (action && typeof action.receiptId === "string") this.#receipts.add(action.receiptId);
    if (rejection) {
      if (known) known.rejectedActions += 1;
      const item = this.#recordEvidence(action, false, rejection);
      return { accepted: false, reason: rejection, evidence: item };
    }

    known.currentValue = action.portfolioValueAfter;
    known.maxDrawdownBps = Math.max(known.maxDrawdownBps, action.drawdownBps);
    known.acceptedActions += 1;
    const item = this.#recordEvidence(action, true, null);
    return { accepted: true, reason: null, evidence: item };
  }

  #validateAction(action) {
    if (!action || typeof action !== "object") return RejectionCode.MALFORMED_ACTION;
    const integerFields = ["submittedAt", "allocationUnits", "portfolioValueBefore", "portfolioValueAfter", "drawdownBps"];
    if (integerFields.some((field) => !Number.isSafeInteger(action[field]) || action[field] < 0)) return RejectionCode.MALFORMED_ACTION;
    if (typeof action.receiptId !== "string" || action.receiptId.length === 0) return RejectionCode.MALFORMED_ACTION;
    if (!this.#strategies.has(action.strategyCommitment)) return RejectionCode.UNREGISTERED_STRATEGY;
    if (action.submittedAt < this.rules.startTime) return RejectionCode.ACTION_BEFORE_START;
    if (action.submittedAt > this.rules.endTime || this.closedAt !== null) return RejectionCode.ACTION_AFTER_CLOSE;
    if (this.#receipts.has(action.receiptId)) return RejectionCode.DUPLICATE_RECEIPT;
    if (!this.rules.allowedAssets.includes(action.asset)) return RejectionCode.UNSUPPORTED_ASSET;
    if (!this.rules.allowedTargets.includes(action.target)) return RejectionCode.UNAUTHORIZED_TARGET;
    const strategy = this.#strategies.get(action.strategyCommitment);
    if (action.portfolioValueBefore !== strategy.currentValue) return RejectionCode.MALFORMED_ACTION;
    if (action.drawdownBps > 10_000) return RejectionCode.MALFORMED_ACTION;
    if (action.allocationUnits * 10_000 > action.portfolioValueBefore * this.rules.maxAllocationBps) return RejectionCode.ALLOCATION_EXCEEDED;
    return null;
  }

  #recordEvidence(action, accepted, reason) {
    const item = Object.freeze({
      sequence: this.#evidence.length + 1,
      receiptId: action?.receiptId ?? "MALFORMED",
      strategyCommitment: action?.strategyCommitment ?? "UNKNOWN",
      submittedAt: action?.submittedAt ?? null,
      asset: action?.asset ?? null,
      target: action?.target ?? null,
      allocationUnits: action?.allocationUnits ?? null,
      accepted,
      reason,
    });
    this.#evidence.push(item);
    return item;
  }

  close({ caller, closedAt }) {
    invariant(caller === this.sponsor, "only sponsor may close arena");
    invariant(Number.isSafeInteger(closedAt), "closedAt must be integer unix seconds");
    invariant(closedAt >= this.rules.endTime, "cannot close before end time");
    invariant(this.closedAt === null, "arena already closed");
    this.closedAt = closedAt;
    return this.leaderboard();
  }

  leaderboard() {
    invariant(this.closedAt !== null, "arena is not closed");
    return [...this.#strategies.values()]
      .map((strategy) => {
        const returnBps = calculateReturnBps(this.rules.startingUnits, strategy.currentValue);
        const eligible = strategy.maxDrawdownBps <= this.rules.maxDrawdownBps;
        return Object.freeze({
          label: strategy.label,
          commitment: strategy.commitment,
          finalValue: strategy.currentValue,
          returnBps,
          maxDrawdownBps: strategy.maxDrawdownBps,
          eligible,
          scoreBps: eligible ? returnBps - strategy.maxDrawdownBps : null,
          acceptedActions: strategy.acceptedActions,
          rejectedActions: strategy.rejectedActions,
          registrationOrder: strategy.registrationOrder,
        });
      })
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        if (a.eligible && a.scoreBps !== b.scoreBps) return b.scoreBps - a.scoreBps;
        if (a.maxDrawdownBps !== b.maxDrawdownBps) return a.maxDrawdownBps - b.maxDrawdownBps;
        return a.registrationOrder - b.registrationOrder;
      });
  }

  settle({ caller, amountUnits, settledAt }) {
    invariant(caller === this.sponsor, "only sponsor may settle arena");
    invariant(this.closedAt !== null, "arena must be closed before settlement");
    invariant(this.#settlement === null, "arena already settled");
    invariant(Number.isSafeInteger(amountUnits) && amountUnits >= 0, "settlement amount must be non-negative");
    invariant(amountUnits <= this.rules.prizeCapUnits, "settlement exceeds prize cap");
    const winner = this.leaderboard().find((entry) => entry.eligible);
    invariant(winner, "no eligible winner");
    this.#settlement = Object.freeze({ winnerCommitment: winner.commitment, amountUnits, settledAt });
    return this.#settlement;
  }

  publicSnapshot() {
    return Object.freeze({
      id: this.id,
      sponsor: this.sponsor,
      rules: this.rules,
      rulesCommitment: this.rulesCommitment,
      createdAt: this.createdAt,
      closedAt: this.closedAt,
      evidence: Object.freeze([...this.#evidence]),
      leaderboard: this.closedAt === null ? [] : Object.freeze(this.leaderboard()),
      settlement: this.#settlement,
    });
  }
}

