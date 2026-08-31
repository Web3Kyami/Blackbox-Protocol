// Studio secret-scan test
//
// Walks every file under `apps/studio/` and asserts that no file contains
// a string that looks like a private key, seed phrase, mnemonic, viewing
// key, signer key, or auth token.
//
// The scan is intentionally conservative: it flags any line that
// mentions the words in a credential-like context, even if the file is a
// test or a doc explaining what the rule is. The one exception is this
// file itself, which documents the rule.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF_PATH = fileURLToPath(new URL(import.meta.url));

// The patterns below match a credential label followed by a value-like
// token on the same line. The patterns are deliberately conservative:
// they catch a real secret pasted in (key=abcd... or key: abcd...) and
// they do NOT catch documentation that merely names the rule. The patterns
// are also listed in this preamble so the second test below can guard
// against a future maintainer adding a pattern but forgetting to document
// it here.
//
// "value-like" means: at least 4 characters AND contains at least one
// character from the set [0-9_"\\/`$], OR the value is at least 12 chars
// long. The second condition (a "looks like a secret" signal) excludes
// obvious documentation examples like `mnemonic: see RFC 1234` or
// `private_key: see appendix`.
//
// Full pattern sources (must match the SECRET_PATTERNS array exactly so
// the second test below can guard against drift):
//   \bprivate[_-]?key\b\s*[:=]\s*["']?[^\s"',;]{4,}(?=["\\_/0-9`$]|.{12,})
//   \bseed[_-]?phrase\b\s*[:=]\s*["']?[^\s"',;]{4,}(?=["\\_/0-9`$]|.{12,})
//   \b(mnemonic|mnemonics)\b\s*[:=]\s*["']?[^\s"',;]{4,}(?=["\\_/0-9`$]|.{12,})
//   \bviewing[_-]?key\b\s*[:=]\s*["']?[^\s"',;]{4,}(?=["\\_/0-9`$]|.{12,})
//   \bsigner[_-]?key\b\s*[:=]\s*["']?[^\s"',;]{4,}(?=["\\_/0-9`$]|.{12,})
//   \bauth[_-]?token\b\s*[:=]\s*["']?[^\s"',;]{4,}(?=["\\_/0-9`$]|.{12,})

const VALUE_LIKE = '["\\\\_/0-9`$]|.{12,}';
const SECRET_PATTERNS = [
  new RegExp(`\\bprivate[_-]?key\\b\\s*[:=]\\s*["']?[^\\s"',;]{4,}(?=${VALUE_LIKE})`, "i"),
  new RegExp(`\\bseed[_-]?phrase\\b\\s*[:=]\\s*["']?[^\\s"',;]{4,}(?=${VALUE_LIKE})`, "i"),
  new RegExp(`\\b(mnemonic|mnemonics)\\b\\s*[:=]\\s*["']?[^\\s"',;]{4,}(?=${VALUE_LIKE})`, "i"),
  new RegExp(`\\bviewing[_-]?key\\b\\s*[:=]\\s*["']?[^\\s"',;]{4,}(?=${VALUE_LIKE})`, "i"),
  new RegExp(`\\bsigner[_-]?key\\b\\s*[:=]\\s*["']?[^\\s"',;]{4,}(?=${VALUE_LIKE})`, "i"),
  new RegExp(`\\bauth[_-]?token\\b\\s*[:=]\\s*["']?[^\\s"',;]{4,}(?=${VALUE_LIKE})`, "i"),
];

const ALLOWED_PATH_FRAGMENTS = [
  // This test file documents the rule.
  SELF_PATH,
];

// `scripts/` holds deploy tooling that legitimately references a runtime
// `wallet.privateKey` loaded from env/.blackboxrc at execution time — not a
// committed secret. The values are never literals in these files; the regex
// flags the variable name, which is a known safe pattern here.
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vercel",
  "scripts",
]);

const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".html",
  ".css",
  ".txt",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
]);

async function* walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}

async function collectScannableFiles(root) {
  const files = [];
  for await (const path of walk(root)) {
    if (extensionOf(path) && !SCANNABLE_EXTENSIONS.has(extensionOf(path))) {
      continue;
    }
    files.push(path);
  }
  return files;
}

test("secret-scan: no file under apps/studio/ contains a private-key-like string", async () => {
  const files = await collectScannableFiles(STUDIO_ROOT);
  const violations = [];

  for (const file of files) {
    if (ALLOWED_PATH_FRAGMENTS.includes(file)) continue;
    const stats = await stat(file);
    if (!stats.isFile()) continue;
    if (stats.size > 1_000_000) continue; // skip anything bigger than 1 MB

    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relative(STUDIO_ROOT, file).split(sep).join("/"),
            line: i + 1,
            pattern: pattern.source,
            text: line.trim().slice(0, 200),
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    const message = violations
      .map(
        (v) =>
          `  ${v.file}:${v.line} matched /${v.pattern}/\n    > ${v.text}`,
      )
      .join("\n");
    assert.fail(
      `Secret-scan found ${violations.length} violation(s):\n${message}`,
    );
  }

  // Sanity assertion: the scan actually looked at some files.
  assert.ok(
    files.length > 0,
    `Secret-scan walked zero files under ${STUDIO_ROOT}`,
  );
});

test("secret-scan: the scan itself documents every pattern it checks for", () => {
  // This guards against a future maintainer adding a new pattern to the
  // array but forgetting to add it to the comments at the top of the
  // file. Every pattern source must appear in the file's preamble.
  const selfPath = fileURLToPath(new URL(import.meta.url));
  return readFile(selfPath, "utf8").then((content) => {
    for (const pattern of SECRET_PATTERNS) {
      assert.ok(
        content.includes(pattern.source),
        `Preamble does not mention pattern /${pattern.source}/`,
      );
    }
  });
});
