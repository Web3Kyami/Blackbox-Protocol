import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTreasuryDeploymentPlan } from "../packages/capability-sdk/src/index.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);

function option(name, fallback) {
  const index = argumentsList.indexOf(name);
  if (index === -1) return fallback;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

const configArgument = option("--config");
if (!configArgument) {
  throw new Error("Usage: npm run release:capability -- --config <public-config.json> [--out <manifest.json>]");
}
const outputArgument = option("--out", "dist/capability-release.json");

const contractNames = ["CapabilityGatekeeper", "CapabilityToken", "TreasurySpendAdapter"];
const sourceNames = [
  "capability_gatekeeper.cairo",
  "capability_token.cairo",
  "treasury_spend_adapter.cairo",
];

async function digest(path) {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

const configPath = resolve(repoRoot, configArgument);
const outputPath = resolve(repoRoot, outputArgument);
const config = JSON.parse(await readFile(configPath, "utf8"));
const plan = buildTreasuryDeploymentPlan(config.deployment ?? config);

const artifacts = [];
for (const contract of contractNames) {
  for (const kind of ["contract_class", "compiled_contract_class"]) {
    const path = resolve(
      repoRoot,
      `contracts/target/dev/blackbox_arena_contracts_${contract}.${kind}.json`,
    );
    artifacts.push({
      contract,
      kind,
      path: relative(repoRoot, path),
      sha256: await digest(path),
    });
  }
}

const sources = [];
for (const name of sourceNames) {
  const path = resolve(repoRoot, "contracts/src", name);
  sources.push({ path: relative(repoRoot, path), sha256: await digest(path) });
}

const manifest = {
  schemaVersion: 1,
  status: "UNSIGNED_RELEASE_BUNDLE",
  configLabel: config.label ?? null,
  toolchain: { scarb: "2.17.0", starknetFoundry: "0.59.0" },
  sources,
  artifacts,
  deploymentPlan: plan,
  requiredVerification: [
    "cd contracts && scarb build && scarb test",
    "npm run verify",
    "npm run verify:capability",
    "independently recompute class hashes from the listed artifacts",
    "verify live STRK20 pool and service compatibility",
    "obtain explicit owner approval before any mainnet signature",
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote unsigned capability release bundle to ${relative(repoRoot, outputPath)}.`);
