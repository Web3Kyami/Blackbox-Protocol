// Build the standalone browser entry with its installed Starknet dependency.
// This is a local preview artifact only: no deploy, wallet, or network write.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const studioRoot = fileURLToPath(new URL("../", import.meta.url));
const outdir = fileURLToPath(new URL("../preview/", import.meta.url));
await mkdir(outdir, { recursive: true });
// Verified public Mainnet reference configuration. New mandate receipts replace
// the gatekeeper and adapter in browser state after deployment.
await writeFile(
  `${outdir}runtime-config.mjs`,
  `window.__BLACKBOX_STUDIO_CONFIG__ = Object.freeze({ network: Object.freeze({\n` +
    `  network: "mainnet",\n` +
    `  rpcUrl: "https://rpc.starknet.lava.build",\n` +
    `  gatekeeper: "0x01126ea67555e0d82c51efe0352f9cf99aec81b7af40ff9c3dab4ccced5b8ff8",\n` +
    `  adapter: "0x021a77531446c9a0e581e4199d9296d00fe45d279c631d0d0ab16cc66340afd7",\n` +
    `  asset: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",\n` +
    `  privacyPool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"\n` +
    `}) });\n`,
  "utf8",
);
await build({
  bundle: true,
  entryPoints: [fileURLToPath(new URL("../src/ui/app.mjs", import.meta.url))],
  format: "esm",
  minify: true,
  outdir,
  entryNames: "app",
  outExtension: { ".js": ".mjs" },
  // Emit one stable module so an open wallet session cannot lose a generated
  // flow chunk when the local preview is rebuilt.
  splitting: false,
  platform: "browser",
  sourcemap: true,
  target: "es2022",
});
const sourceHtml = await readFile(`${studioRoot}index.html`, "utf8");
await writeFile(
  `${outdir}index.html`,
  sourceHtml
    .replace('./src/ui/style.css', './style.css')
    .replace('./preview/runtime-config.mjs', './runtime-config.mjs')
    .replace('./preview/app.mjs', './app.mjs'),
  "utf8",
);
await copyFile(`${studioRoot}src/ui/style.css`, `${outdir}style.css`);
for (const relative of await readdir(outdir, { recursive: true })) {
  if (!relative.endsWith(".mjs")) continue;
  const file = `${outdir}${relative}`;
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace(/[ \t]+$/gm, ""), "utf8");
}
console.log(`Built Studio preview from ${studioRoot}`);
