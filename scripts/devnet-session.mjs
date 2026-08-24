// Localhost Devnet Session Runner (Windows Host Launcher)
// Spawns wsl.exe directly without shell:true.
// Pinned toolchain: Devnet 0.8.0-rc.3 | Scarb 2.17.0 | Node 24.19.0 | WSL Ubuntu / kyami

import { spawn } from "node:child_process";

console.log("[devnet-session] Launching Devnet session service in WSL Ubuntu (kyami)...");
console.log("[devnet-session] Pinned versions: Devnet 0.8.0-rc.3 | Scarb 2.17.0 | Node 24.19.0");

const pinnedPath = [
  "/home/kyami/.asdf/installs/scarb/2.17.0/bin",
  "/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin",
  "/home/kyami/.nvm/versions/node/v24.19.0/bin",
  "/home/kyami/.cargo/bin",
  "/home/kyami/.local/bin",
  "/usr/bin",
  "/bin",
].join(":");

const sessionCmd =
  "export PATH=" + pinnedPath +
  " && npx --no-install tsx ../../../packages/devnet-session/src/session-cli.ts";

const child = spawn(
  "wsl.exe",
  [
    "-d", "Ubuntu",
    "-u", "kyami",
    "--cd", "/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/e2e",
    "--",
    "bash", "-lc", sessionCmd,
  ],
  {
    stdio: "inherit",
    shell: false,
  },
);

child.on("error", (err) => {
  console.error("[devnet-session] Failed to spawn wsl.exe:", err.message);
  process.exit(1);
});

child.on("exit", (code) => {
  console.log(`[devnet-session] Process exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});
