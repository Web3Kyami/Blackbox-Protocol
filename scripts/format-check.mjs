import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const extensions = new Set([".mjs", ".json", ".md", ".css", ".html", ".cairo", ".toml"]);
const ignored = new Set([".git", ".local", "dist", "node_modules", "target", "_research"]);
const failures = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extensions.has(extname(entry.name))) {
      const source = await readFile(path, "utf8");
      if (!source.endsWith("\n")) failures.push(`${path}: missing final newline`);
      source.split("\n").forEach((line, index) => { if (/\s+$/.test(line)) failures.push(`${path}:${index + 1}: trailing whitespace`); });
    }
  }
}
await walk(".");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("Formatting checks passed.");
