import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { runCaseStudy } from "../fixtures/strategies/case-study.mjs";

const output = new URL("../dist/web/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("../apps/web/src/", import.meta.url), output, { recursive: true });
// Keep the interactive console separate from the marketing page. `index.html`
// remains its source so the same checked UI can be served as `/app.html`.
await cp(new URL("../apps/web/src/holder-app.html", import.meta.url), new URL("app.html", output));
await cp(new URL("../apps/web/src/home.html", import.meta.url), new URL("index.html", output));
await cp(new URL("../apps/web/src/docs-hub.html", import.meta.url), new URL("docs.html", output));
await cp(new URL("../apps/web/src/security-v2.html", import.meta.url), new URL("security.html", output));
await cp(new URL("../apps/web/src/docs/overview-page.html", import.meta.url), new URL("docs/overview.html", output));
await cp(new URL("../apps/web/src/docs/integrate-page.html", import.meta.url), new URL("docs/integrate.html", output));
await cp(new URL("../apps/web/src/docs/use-page.html", import.meta.url), new URL("docs/use-a-capability.html", output));
for (const page of [
  "index.html", "app.html", "use-cases.html", "docs.html", "security.html",
  "docs/overview.html", "docs/integrate.html", "docs/use-a-capability.html",
]) {
  const path = new URL(page, output);
  const html = await readFile(path, "utf8");
  await writeFile(path, html.replace("</body>", '<script type="module" src="/footer.mjs"></script></body>'));
}
await cp(
  new URL("../packages/capability-sdk/src/index.mjs", import.meta.url),
  new URL("capability-sdk.mjs", output),
);
await build({
  entryPoints: [fileURLToPath(new URL("../apps/web/src/app.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("app.mjs", output)),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  legalComments: "eof",
});
await build({
  entryPoints: [fileURLToPath(new URL("../apps/web/src/holder-app.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("holder-app.mjs", output)), bundle: true, format: "esm", platform: "browser", target: ["es2022"], sourcemap: true, legalComments: "eof",
});
const { arena } = runCaseStudy();
await writeFile(new URL("case-study.json", output), `${JSON.stringify(arena.publicSnapshot(), null, 2)}\n`, "utf8");
console.log("Built BlackBox Protocol site, holder app, docs, and capability SDK.");
