import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arenaRoot = resolve(packageRoot, "../..");
const privacyRoot = resolve(
  process.env.BLACKBOX_PRIVACY_REPO ??
    join(arenaRoot, "_research/starknet-privacy"),
);
const e2eRoot = join(privacyRoot, "e2e");

const requiredPaths = [
  join(e2eRoot, "node_modules/vitest/vitest.mjs"),
  join(privacyRoot, "sdk/dist/index.js"),
  join(privacyRoot, "target/dev/privacy_Privacy.contract_class.json"),
  join(privacyRoot, "target/dev/privacy_Privacy.compiled_contract_class.json"),
  join(privacyRoot, "target/release/discovery-service"),
];
const missingPaths = requiredPaths.filter((path) => !existsSync(path));
if (missingPaths.length > 0) {
  console.error("The selected privacy checkout is not ready for capability E2E:");
  for (const path of missingPaths) console.error(`- ${path}`);
  console.error(
    "Build the privacy contract, SDK, and discovery service in that checkout first.",
  );
  process.exit(1);
}

console.log(`BlackBox capability E2E privacy checkout: ${privacyRoot}`);
const result = spawnSync(
  process.execPath,
  [
    join(e2eRoot, "node_modules/vitest/vitest.mjs"),
    "run",
    "--config",
    join(packageRoot, "vitest.config.ts"),
    join(packageRoot, "test/capability-protocol.test.ts"),
    "--reporter=verbose",
    "--testTimeout=180000",
    "--hookTimeout=180000",
  ],
  {
    cwd: e2eRoot,
    env: { ...process.env, BLACKBOX_PRIVACY_REPO: privacyRoot },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
