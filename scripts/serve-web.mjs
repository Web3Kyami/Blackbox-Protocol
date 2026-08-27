import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(fileURLToPath(new URL("../dist/web/", import.meta.url)));
if (!existsSync(join(root, "index.html"))) {
  await import("./build-web.mjs");
}
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".md": "text/plain; charset=utf-8" };
const server = createServer((request, response) => {
  const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const initial = normalize(join(root, requested));
  const path = existsSync(initial) && statSync(initial).isFile()
    ? initial
    : existsSync(`${initial}.html`)
      ? `${initial}.html`
      : join(initial, "index.html");
  if (!path.startsWith(root) || !existsSync(path)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});
const port = Number(process.env.BLACKBOX_PORT ?? 4173);
server.listen(port, "0.0.0.0", () => console.log(`BlackBox Protocol: http://localhost:${port}`));
