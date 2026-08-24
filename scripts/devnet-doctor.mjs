#!/usr/bin/env node

/**
 * Devnet Environment Doctor
 *
 * Reads environment state and reports what is present, what is missing,
 * and the exact remediation command required for each gap.
 *
 * Does NOT install, modify, or execute anything automatically.
 *
 * Usage from Windows PowerShell:
 *   npm run devnet:doctor
 */

import { spawn } from "node:child_process";

const pinnedPath = [
  "/home/kyami/.asdf/installs/scarb/2.17.0/bin",
  "/home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin",
  "/home/kyami/.nvm/versions/node/v24.19.0/bin",
  "/home/kyami/.cargo/bin",
  "/home/kyami/.local/bin",
  "/usr/bin",
  "/bin",
].join(":");

const checks = [
  {
    label: "WSL distro Ubuntu is accessible",
    cmd: "printf Ubuntu",
    expected: "Ubuntu",
    remediation: "Verify Ubuntu WSL distribution is installed and accessible",
  },
  {
    label: "WSL user is kyami",
    cmd: "id -un",
    expected: "kyami",
    remediation: "Ensure WSL is configured with user kyami",
  },
  {
    label: "Node.js 24.19.0",
    cmd: "node --version",
    expected: "v24.19.0",
    remediation: "Ensure Node.js 24.19.0 is selected in WSL environment",
  },
  {
    label: "npm 11.17.0",
    cmd: "npm --version",
    expected: "11.17.0",
    remediation: "Ensure npm 11.17.0 is selected in WSL environment",
  },
  {
    label: "Rust/Cargo 1.98.0",
    cmd: "cargo --version",
    expected: "cargo 1.98.0",
    remediation: "Ensure Rust/Cargo 1.98.0 toolchain is active in WSL",
  },
  {
    label: "Scarb 2.17.0",
    cmd: "/home/kyami/.asdf/installs/scarb/2.17.0/bin/scarb --version",
    expected: "scarb 2.17.0",
    remediation: "Ensure Scarb 2.17.0 is installed in /home/kyami/.asdf/installs/scarb/2.17.0/bin",
  },
  {
    label: "Starknet Devnet 0.8.0-rc.3",
    cmd: "starknet-devnet --version",
    expected: "0.8.0-rc.3",
    remediation: "Ensure Starknet Devnet 0.8.0-rc.3 is installed in /home/kyami/.asdf/installs/starknet-devnet/0.8.0-rc.3/bin",
  },
  {
    label: "Upstream privacy checkout exists (_research/starknet-privacy)",
    cmd: `test -d '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy' && echo PASS`,
    expected: "PASS",
    remediation: "Clone the upstream privacy repo: git clone <upstream-url> _research/starknet-privacy",
  },
  {
    label: "Privacy SDK e2e node_modules installed",
    cmd: `test -d '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/e2e/node_modules/@starkware-libs' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd _research/starknet-privacy/e2e && npm ci",
  },
  {
    label: "Privacy SDK built (sdk/dist exists)",
    cmd: `test -d '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/sdk/dist' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd _research/starknet-privacy/sdk && npm ci && npm run build",
  },
  {
    label: "Privacy contract dev artifacts exist",
    cmd: `test -f '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/target/dev/privacy_Privacy.contract_class.json' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd _research/starknet-privacy && /home/kyami/.asdf/installs/scarb/2.17.0/bin/scarb build -p privacy",
  },
  {
    label: "Test-token artifacts exist",
    cmd: `test -f '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/e2e/contracts/test-token/target/dev/test_token_TestToken.contract_class.json' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd _research/starknet-privacy/e2e/contracts/test-token && /home/kyami/.asdf/installs/scarb/2.17.0/bin/scarb build",
  },
  {
    label: "Discovery service binary exists",
    cmd: `test -f '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/_research/starknet-privacy/target/release/discovery-service' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd _research/starknet-privacy && cargo build --release -p discovery-service",
  },
  {
    label: "Blackbox Arena contract artifact exists",
    cmd: `test -f '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/contracts/target/dev/blackbox_arena_contracts_Arena.contract_class.json' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd contracts && /home/kyami/.asdf/installs/scarb/2.17.0/bin/scarb build",
  },
  {
    label: "Blackbox ArenaAdapter contract artifact exists",
    cmd: `test -f '/mnt/c/Users/USER/Documents/ChatGPT/BlackBox Arena/contracts/target/dev/blackbox_arena_contracts_ArenaAdapter.contract_class.json' && echo PASS`,
    expected: "PASS",
    remediation: "Run in WSL: cd contracts && /home/kyami/.asdf/installs/scarb/2.17.0/bin/scarb build",
  },
];

function wslCheck(cmd) {
  return new Promise((resolve) => {
    const child = spawn(
      "wsl.exe",
      [
        "-d", "Ubuntu",
        "-u", "kyami",
        "--",
        "bash", "-lc",
        `export PATH=${pinnedPath} && ${cmd}`,
      ],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", () => resolve({ out: "", code: 1 }));
    child.on("exit", (code) => resolve({ out: out.trim(), code: code ?? 1 }));
  });
}

console.log("=".repeat(60));
console.log("  Blackbox Arena — Devnet Environment Doctor");
console.log("=".repeat(60));
console.log("  Read-only diagnostic. Does NOT install or modify anything.");
console.log("=".repeat(60));
console.log();

let allPassed = true;

for (const check of checks) {
  const result = await wslCheck(check.cmd);
  const out = result.out;
  const code = result.code;
  const expected = check.expected;
  let pass = code === 0;
  if (expected) {
    pass = out.startsWith(expected) || out.includes(expected);
  }

  if (pass) {
    console.log(`  \u2713 ${check.label}`);
    if (out && out !== "PASS") console.log(`      \u2192 ${out.split("\n")[0]}`);
  } else {
    console.log(`  \u2717 ${check.label}`);
    if (out) console.log(`      Got: ${out.split("\n")[0]}`);
    console.log(`      Fix: ${check.remediation}`);
    allPassed = false;
  }
}

console.log();
console.log("=".repeat(60));
if (allPassed) {
  console.log("  All checks passed. Environment ready for verify:devnet.");
} else {
  console.log("  One or more prerequisites are missing.");
  console.log("  Fix the items marked \u2717 above before running verify:devnet.");
  console.log("  This doctor does NOT run fixes automatically.");
}
console.log("=".repeat(60));

process.exit(allPassed ? 0 : 1);
