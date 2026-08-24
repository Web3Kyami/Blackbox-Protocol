import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { runCaseStudy } from "../fixtures/strategies/case-study.mjs";

const output = new URL("../dist/web/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("../apps/web/src/", import.meta.url), output, { recursive: true });
const { arena } = runCaseStudy();
await writeFile(new URL("case-study.json", output), `${JSON.stringify(arena.publicSnapshot(), null, 2)}\n`, "utf8");
console.log("Built dist/web with deterministic case-study state.");

