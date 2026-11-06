import { cp, mkdir, rm } from "node:fs/promises";

await import("./package-schedule-neon-esm.mjs");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
