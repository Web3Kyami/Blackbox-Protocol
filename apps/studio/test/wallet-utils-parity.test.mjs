// wallet-utils-parity.test.mjs
// Parity test for apps/studio/src/wallet/wallet-utils.mjs vs.
// apps/web/src/wallet-operator.mjs (the upstream file).
//
// Mirrors test/sdk-parity.test.mjs: this test must NOT import the
// upstream file at runtime (AGENTS.md line 32-33 forbids a relative
// import that depends on the parent app's uncommitted state). Instead
// we read both files off disk, extract each "body", and assert the
// Studio body is byte-identical to the upstream body. The Studio
// file carries a provenance banner (see src/wallet/wallet-utils.mjs);
// the upstream file does NOT carry a banner — it starts directly
// with `export const MAINNET_CHAIN_ID`.
//
// Body extraction strategy: locate the sentinel line `export const
// MAINNET_CHAIN_ID` (or the first non-banner code line) in each
// file and slice from that line to end-of-file. This works for
// both shapes (banner-present and banner-absent) without a regex
// that has to match a particular banner format.
//
// The upstream sha256 is re-locked in the assertion. If the parent
// app's wallet-operator.mjs changes, this test fails loudly and the
// owner reviews before re-locking.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, "..");

const STUDIO_WALLET = join(studioRoot, "src/wallet/wallet-utils.mjs");
const UPSTREAM_WALLET = join(studioRoot, "..", "..", "apps", "web", "src", "wallet-operator.mjs");

// Upstream sha256 of wallet-operator.mjs, snapshotted 2026-08-28.
const UPSTREAM_WALLET_SHA256 =
  "ae1128a94f9d2cc7fadb0cb0a446d7177e9a6c3b3c8f7f55fd7d724e7270891a";

// The sentinel that marks the start of the code body. The upstream
// file is body-only and starts with this line. The Studio copy has
// a comment banner above it; the body still starts with this line.
const BODY_SENTINEL = "export const MAINNET_CHAIN_ID";

// Locate the index of the line that begins the body. A "banner line"
// is a line whose first non-whitespace characters are "//" and which
// is NOT the body sentinel. We advance past any run of banner lines
// at the top of the file. If the file starts with the body sentinel,
// the body begins at line 0.
function findBodyStart(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith(BODY_SENTINEL)) {
      return i;
    }
    if (trimmed.startsWith("//")) continue;
    // Any other top-level non-comment content means the file has no
    // banner and we already passed the body. Defensive: return i.
    return i;
  }
  throw new Error("could not locate body sentinel " + BODY_SENTINEL);
}

function extractBody(text) {
  const lines = text.split("\n");
  const start = findBodyStart(text);
  return lines.slice(start).join("\n");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("upstream wallet-operator file is present and non-empty", () => {
  const text = readFileSync(UPSTREAM_WALLET, "utf8");
  assert.ok(text.length > 0, "upstream wallet-operator.mjs must be non-empty");
});

test("upstream wallet-operator file still matches its snapshotted sha256", () => {
  const text = readFileSync(UPSTREAM_WALLET, "utf8");
  const hash = sha256(text);
  assert.equal(
    hash,
    UPSTREAM_WALLET_SHA256,
    "upstream wallet-operator.mjs changed — review and re-lock the sha256",
  );
});

test("Studio wallet-utils declares a provenance banner", () => {
  const text = readFileSync(STUDIO_WALLET, "utf8");
  assert.match(text, /provenance/);
  assert.match(text, /wallet-operator\.mjs/);
  // The body sentinel is present somewhere in the file.
  assert.match(text, new RegExp("^" + BODY_SENTINEL, "m"));
});

test("Studio wallet-utils body is byte-identical to the upstream wallet-operator body", () => {
  const upstreamText = readFileSync(UPSTREAM_WALLET, "utf8");
  const studioText = readFileSync(STUDIO_WALLET, "utf8");

  const upstreamBody = extractBody(upstreamText);
  const studioBody = extractBody(studioText);

  assert.equal(
    studioBody,
    upstreamBody,
    "Studio wallet-utils body must equal upstream body byte-for-byte",
  );
  assert.equal(
    sha256(studioBody),
    sha256(upstreamBody),
    "Studio wallet-utils body sha256 must match upstream body sha256",
  );
});
