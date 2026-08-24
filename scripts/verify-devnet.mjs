// Devnet Verification Runner (Windows Host Launcher)
// Spawns wsl.exe directly without shell:true.
// Pinned toolchain: Devnet 0.8.0-rc.3 | Scarb 2.17.0 | Node 24.19.0 | WSL Ubuntu / kyami

import { spawn } from "node:child_process";

console.log("[verify:devnet] Running tracked Devnet test suite in WSL Ubuntu (kyami)...");
console.log("[verify:devnet] Pinned: Devnet 0.8.0-rc.3 | Scarb 2.17.0 | Node 24.19.0");

const pinnedPath = [
  "/home/kyami/.asdf/installs/scarb/2.17.0/bin",
  "/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin",
  "/home/kyami/.nvm/versions/node/v24.19.0/bin",
  "/home/kyami/.cargo/bin",
  "/home/kyami/.local/bin",
  "/usr/bin",
  "/bin",
].join(":");

const vitestCmd =
  "export PATH=" + pinnedPath +
  " && npx --no-install vitest run --config ../../../packages/devnet-session/vitest.config.ts --reporter=verbose --testTimeout=120000 --hookTimeout=120000";

const child = spawn(
  "wsl.exe",
  [
    "-d", "Ubuntu",
    "-u", "kyami",
    "--cd", "/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/e2e",
    "--",
    "bash", "-lc", vitestCmd,
  ],
  {
    stdio: "inherit",
    shell: false,
  },
);

child.on("error", (err) => {
  console.error("[verify:devnet] Failed to spawn wsl.exe:", err.message);
  process.exit(1);
});

child.on("exit", (code) => {
  const rc = code ?? 1;
  if (rc === 0) {
    console.log("[verify:devnet] All Devnet integration tests passed.");
  } else {
    console.error("[verify:devnet] Test run failed with exit code " + rc);
  }
  process.exit(rc);
});
