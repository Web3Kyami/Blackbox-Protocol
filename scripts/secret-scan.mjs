import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ignored = new Set([".git", ".local", "dist", "node_modules", "target", "_research", "LICENSE"]);
const textExtensions = new Set([".mjs", ".js", ".json", ".md", ".css", ".html", ".cairo", ".toml", ".example"]);
const findings = [];
const patterns = [
  ["seed phrase assignment", /(?:seed|mnemonic)\s*[:=]\s*["'][a-z]+(?:\s+[a-z]+){11,23}["']/i],
  ["private key assignment", /(?:private[_ -]?key)\s*[:=]\s*["']?(?:0x)?[0-9a-f]{64}["']?/i],
  ["generic API secret", /(?:api[_ -]?key|secret)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i],
];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".env.local")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (textExtensions.has(extname(entry.name)) || entry.name === ".env.example" || entry.name === ".gitignore") {
      const content = await readFile(path, "utf8");
      patterns.forEach(([label, pattern]) => { if (pattern.test(content)) findings.push(`${path}: ${label}`); });
    }
  }
}
await walk(".");
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else console.log("Secret scan passed (pattern-based; no findings).\n");

