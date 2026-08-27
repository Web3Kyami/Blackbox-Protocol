import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const arenaRoot = resolve(packageRoot, "../..");
const privacyRoot = process.env.BLACKBOX_PRIVACY_REPO
  ? resolve(process.env.BLACKBOX_PRIVACY_REPO)
  : join(arenaRoot, "_research/starknet-privacy");
const e2eRoot = join(privacyRoot, "e2e");
const sdkDist = join(privacyRoot, "sdk/dist");

export default {
  root: e2eRoot,
  test: {
    include: [
      join(packageRoot, "test/stage-a-session.test.ts"),
      join(packageRoot, "test/stage-b-dashboard.test.ts"),
      join(packageRoot, "test/stage-c-lifecycle.test.ts"),
      join(packageRoot, "test/blackbox-arena.test.ts"),
      join(packageRoot, "test/capability-protocol.test.ts"),
    ],
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 120000,
    setupFiles: [join(e2eRoot, "src/vitest-setup.ts")],
  },
  resolve: {
    alias: [
      {
        find: "@starkware-libs/starknet-privacy-sdk/testing",
        replacement: join(sdkDist, "testing/index.js"),
      },
      {
        find: "@starkware-libs/starknet-privacy-sdk",
        replacement: join(sdkDist, "index.js"),
      },
    ],
  },
};
