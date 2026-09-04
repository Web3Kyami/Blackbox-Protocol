const RECOVERY_VERSION = 1;
const RECOVERABLE_VIEWS = new Set(["home", "wizard", "dashboard", "mandate", "delivery", "holder"]);

function clone(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return fallback; }
}

export function uiRecoverySnapshot(state = {}) {
  const view = RECOVERABLE_VIEWS.has(state.view) ? state.view : "home";
  return {
    version: RECOVERY_VERSION,
    view,
    step: Number.isInteger(state.step) ? Math.max(0, Math.min(5, state.step)) : 0,
    draft: clone(state.draft, {}),
    acknowledgedBoundary: state.acknowledgedBoundary === true,
    plan: clone(state.plan),
    planError: typeof state.planError === "string" ? state.planError : null,
    mandate: clone(state.mandate),
    holderToken: String(state.holder?.token || ""),
  };
}

export function readUiRecovery(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    if (!value || value.version !== RECOVERY_VERSION || !RECOVERABLE_VIEWS.has(value.view)) return null;
    return {
      ...value,
      step: Number.isInteger(value.step) ? Math.max(0, Math.min(5, value.step)) : 0,
      draft: value.draft && typeof value.draft === "object" ? value.draft : {},
      mandate: value.mandate && typeof value.mandate === "object" ? value.mandate : null,
      holderToken: String(value.holderToken || ""),
    };
  } catch {
    return null;
  }
}

export function writeUiRecovery(storage, key, state) {
  try {
    storage.setItem(key, JSON.stringify(uiRecoverySnapshot(state)));
    return true;
  } catch {
    return false;
  }
}
