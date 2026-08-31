export function formatTokenAmount(value, symbol = "STRK") {
  if (value == null || value === "") return "0";
  if (symbol !== "STRK") return String(value);
  let atomic;
  try { atomic = BigInt(value); } catch { return String(value); }
  const unit = 10n ** 18n;
  const whole = atomic / unit;
  const fraction = (atomic % unit).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
