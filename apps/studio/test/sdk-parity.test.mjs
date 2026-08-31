// Studio SDK parity test
//
// This test verifies that the Studio copy of the Capability SDK at
//   ../src/sdk/blackbox-capability-sdk.mjs
// is a faithful copy of the upstream file at
//   ../../packages/capability-sdk/src/index.mjs
// that was snapshotted on 2026-08-28.
//
// Important boundary note
// -----------------------
// `apps/studio/AGENTS.md` forbids Studio from importing source files by
// relative paths that depend on uncommitted edits outside the folder.
// This test therefore does NOT `import` the upstream file at runtime.
// Instead it reads the on-disk upstream file as bytes, slices the body
// out of the Studio copy, and asserts a sha256 match. The relative path
// is used only by the Node `fs` reader for the parity check itself, and
// the test fails if the file is missing.
//
// If the upstream file ever changes:
//   1. Re-copy the new upstream file into Studio
//      (preserving the existing banner).
//   2. Update `EXPECTED_UPSTREAM_SHA256` below to the new sha256.
//   3. Update `BANNER_LINE_COUNT` below to match the new banner size.
//   4. Re-run this test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// -----------------------------------------------------------------------------
// Pin the upstream snapshot the Studio copy was taken from.
// -----------------------------------------------------------------------------

const EXPECTED_UPSTREAM_SHA256 =
  "7870e3c4d5af165cd629044b10528c190f01925ec30829d9dfd1225dc04f52d0";
const EXPECTED_UPSTREAM_BYTES = 14_390;
const EXPECTED_UPSTREAM_LINES = 419;

const STUDIO_SDK_PATH = new URL(
  "../src/sdk/blackbox-capability-sdk.mjs",
  import.meta.url,
);
const UPSTREAM_SDK_PATH = new URL(
  "../../../packages/capability-sdk/src/index.mjs",
  import.meta.url,
);

// -----------------------------------------------------------------------------
// 1. Upstream file still on disk and still matches the snapshotted sha256
// -----------------------------------------------------------------------------

test("upstream SDK file is still on disk with the expected byte count", async () => {
  const bytes = await readFile(UPSTREAM_SDK_PATH);
  assert.equal(
    bytes.byteLength,
    EXPECTED_UPSTREAM_BYTES,
    `upstream file size changed from ${EXPECTED_UPSTREAM_BYTES} to ${bytes.byteLength} bytes — was the SDK updated?`,
  );
});

test("upstream SDK file still matches the snapshotted sha256", async () => {
  const bytes = await readFile(UPSTREAM_SDK_PATH);
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    actual,
    EXPECTED_UPSTREAM_SHA256,
    `upstream SDK sha256 changed from ${EXPECTED_UPSTREAM_SHA256} to ${actual} — re-copy and update EXPECTED_UPSTREAM_SHA256`,
  );
});

// -----------------------------------------------------------------------------
// 2. Studio copy body is byte-identical to the upstream file
// -----------------------------------------------------------------------------

async function studioSdkBodyText() {
  const studioText = await readFile(STUDIO_SDK_PATH, "utf8");
  // The banner ends at the line immediately before the SDK's JSDoc opener.
  // The SDK's first non-banner line is the literal `/**` opener.
  const bannerEnd = studioText.indexOf("\n/**\n");
  assert.notEqual(
    bannerEnd,
    -1,
    "Could not find SDK JSDoc opener in Studio copy — banner may have been edited",
  );
  // Body is everything from the `/**` opener to EOF. The trailing newline
  // is part of the body and must be preserved for byte-identity.
  return studioText.slice(bannerEnd + 1);
}

test("Studio SDK body is byte-identical to the upstream file", async () => {
  const upstreamBytes = await readFile(UPSTREAM_SDK_PATH);
  const upstreamText = new TextDecoder("utf-8").decode(upstreamBytes);
  const studioBody = await studioSdkBodyText();

  const upstreamSha = createHash("sha256")
    .update(upstreamText, "utf8")
    .digest("hex");
  const studioSha = createHash("sha256")
    .update(studioBody, "utf8")
    .digest("hex");
  assert.equal(
    studioSha,
    upstreamSha,
    `Studio copy body sha256 (${studioSha}) does not match upstream (${upstreamSha})`,
  );
});

test("Studio SDK body is byte-identical to the snapshotted sha256", async () => {
  const studioBody = await studioSdkBodyText();
  const studioSha = createHash("sha256")
    .update(studioBody, "utf8")
    .digest("hex");
  assert.equal(
    studioSha,
    EXPECTED_UPSTREAM_SHA256,
    `Studio copy body sha256 (${studioSha}) does not match the snapshotted upstream sha256 (${EXPECTED_UPSTREAM_SHA256})`,
  );
});

test("Studio SDK body line count matches upstream line count", async () => {
  // `wc -l` reports the number of newline characters; a file that ends
  // with a newline has `wc -l` = number of lines. `split("\n").length`
  // returns one more than `wc -l` when the file ends with a newline.
  // Both files end with `\n`, so the split-based line count must equal
  // EXPECTED_UPSTREAM_LINES + 1.
  const studioBody = await studioSdkBodyText();
  const studioLineCount = studioBody.split("\n").length;
  assert.equal(
    studioLineCount,
    EXPECTED_UPSTREAM_LINES + 1,
    `Studio body split-length is ${studioLineCount}; expected ${EXPECTED_UPSTREAM_LINES + 1} (upstream lines ${EXPECTED_UPSTREAM_LINES} + 1 for the trailing newline)`,
  );
});

// -----------------------------------------------------------------------------
// 3. Studio copy's banner is present and the file is loadable as a module
// -----------------------------------------------------------------------------

test("Studio SDK file declares a provenance banner", async () => {
  const studioText = await readFile(STUDIO_SDK_PATH, "utf8");
  assert.match(studioText, /Studio provenance banner/);
  assert.match(studioText, /packages\/capability-sdk\/src\/index\.mjs/);
  assert.match(studioText, new RegExp(EXPECTED_UPSTREAM_SHA256));
  assert.match(studioText, /0x62b8b737e10c4b06727e9ef672fc0163f8331388e812a249f28cc9edaa63efe/); // CapabilityGatekeeper
  assert.match(studioText, /0x408fa2fde6f253b3771c43181c8eb8c7f5f71a929c4bd74cb0b25852e5a17e7/); // CapabilityToken
  assert.match(studioText, /0x7617280a31c7ffbf16b5eb18e7f783d1953d295277b293eb816b304041a3da0/); // TreasurySpendAdapter
});

test("Studio SDK module loads and exports the documented set", async () => {
  const mod = await import(STUDIO_SDK_PATH.pathname);
  // First two are constants; the rest are functions. Test exact types so
  // future export-shape changes are caught here, not in production code.
  assert.equal(typeof mod.CAPABILITY_UNIT, "bigint", "CAPABILITY_UNIT must be a bigint");
  assert.equal(mod.CAPABILITY_UNIT, 1n, "CAPABILITY_UNIT must equal 1n");
  assert.equal(typeof mod.OPEN_AMOUNT, "string", "OPEN_AMOUNT must be a string");
  assert.equal(mod.OPEN_AMOUNT, "OPEN", "OPEN_AMOUNT must equal 'OPEN'");
  const expectedFunctions = [
    "normalizeFelt",
    "validatePolicy",
    "buildRegisterPolicyCall",
    "buildPolicyStatusCall",
    "encodeGatekeeperCalldata",
    "buildCapabilityInvokePlan",
    "buildWalletApiCapabilityActions",
    "buildWalletApiCapabilityDepositActions",
    "buildTreasuryDeploymentPlan",
    "describeDisclosure",
  ];
  for (const name of expectedFunctions) {
    assert.equal(
      typeof mod[name],
      "function",
      `Studio SDK export ${name} is missing or not a function`,
    );
  }
});
