// Local-only server for the exact self-contained artifact Vercel publishes.
// It does not deploy, sign, or proxy any wallet request.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = normalize(fileURLToPath(new URL("../preview/", import.meta.url)));
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

function fileFor(requested) {
  const relative = requested.split("?")[0].replace(/^\//, "") || "index.html";
  const path = normalize(join(studioRoot, relative));
  if (!path.startsWith(studioRoot) || !existsSync(path) || !statSync(path).isFile()) return null;
  return path;
}

const server = createServer((request, response) => {
  const path = fileFor(request.url || "/");
  if (!path) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(path)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(path).pipe(response);
});

const port = Number(process.env.STUDIO_PORT || 4174);
server.listen(port, "127.0.0.1", () => console.log(`BlackBox Studio: http://localhost:${port}`));
