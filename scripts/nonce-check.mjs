// Nonce + pending diagnostics for the deployer account.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const address = env.STARKNET_ACCOUNT_ADDRESS;

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return res.json();
}

for (const url of [
  "https://starknet-sepolia-rpc.publicnode.com",
  "https://starknet-sepolia.drpc.org",
]) {
  console.log(`\n=== ${url} ===`);
  const latest = await rpc(url, "starknet_getNonce", [{ block_number: 13906100 }, address]).catch(() => null);
  const pend = await rpc(url, "starknet_getNonce", ["pending", address]).catch(() => null);
  console.log("nonce(latest@13906100):", JSON.stringify(latest?.result ?? latest));
  console.log("nonce(pending):        ", JSON.stringify(pend?.result ?? pend));
}
