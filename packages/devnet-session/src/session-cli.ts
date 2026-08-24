import { SessionServiceServer } from "./blackbox-session.js";

const server = new SessionServiceServer(4174);
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.stop();
}

process.on("SIGINT", () => {
  void stop().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void stop().finally(() => process.exit(0));
});

await server.start();
console.log("[devnet-session] Service ready on http://127.0.0.1:4174");
