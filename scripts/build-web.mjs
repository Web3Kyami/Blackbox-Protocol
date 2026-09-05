import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const output = new URL("../dist/web/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(new URL("docs/", output), { recursive: true });

// Build Studio from its source, then publish the self-contained artifact under
// the main BlackBox domain. Keeping the app at /studio preserves its own visual
// system and makes policy links survive refreshes without a second deployment.
await import("../apps/studio/scripts/build-preview.mjs");
await mkdir(new URL("studio/", output), { recursive: true });
for (const file of ["index.html", "app.mjs", "runtime-config.mjs", "style.css"]) {
  await cp(
    new URL(`../apps/studio/preview/${file}`, import.meta.url),
    new URL(`studio/${file}`, output),
  );
}

const publicFiles = new Map([
  ["apps/web/src/index.html", "index.html"],
  ["apps/web/src/holder-app.html", "app.html"],
  ["apps/web/src/issue.html", "issue.html"],
  ["apps/web/src/use-cases.html", "use-cases.html"],
  ["apps/web/src/docs.html", "docs.html"],
  ["apps/web/src/security.html", "security.html"],
  ["apps/web/src/docs/overview-page.html", "docs/overview.html"],
  ["apps/web/src/docs/integrate-page.html", "docs/integrate.html"],
  ["apps/web/src/docs/use-page.html", "docs/use-a-capability.html"],
  ["apps/web/src/styles.css", "styles.css"],
  ["apps/web/src/favicon.svg", "favicon.svg"],
  ["apps/web/src/header.mjs", "header.mjs"],
  ["apps/web/src/footer.mjs", "footer.mjs"],
  ["vercel.json", "vercel.json"],
]);

for (const [source, destination] of publicFiles) {
  await cp(new URL(`../${source}`, import.meta.url), new URL(destination, output));
}

for (const page of [
  "index.html", "app.html", "use-cases.html", "docs.html", "security.html",
  "issue.html",
  "docs/overview.html", "docs/integrate.html", "docs/use-a-capability.html",
]) {
  const path = new URL(page, output);
  const html = await readFile(path, "utf8");
  await writeFile(path, html
    .replace("</head>", '<link rel="icon" type="image/svg+xml" href="/favicon.svg"></head>')
    .replace("</body>", '<script type="module" src="/header.mjs"></script><script type="module" src="/footer.mjs"></script></body>'));
}
await build({
  entryPoints: [fileURLToPath(new URL("../apps/web/src/issue.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("issue.mjs", output)), bundle: true, format: "esm", platform: "browser", target: ["es2022"], sourcemap: false, legalComments: "eof",
});
await build({
  entryPoints: [fileURLToPath(new URL("../apps/web/src/holder-app.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("holder-app.mjs", output)), bundle: true, format: "esm", platform: "browser", target: ["es2022"], sourcemap: false, legalComments: "eof",
});
console.log("Built the minimal BlackBox Protocol production site.");
