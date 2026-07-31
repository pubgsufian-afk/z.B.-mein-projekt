import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const files = [
  ["repair/export-core.js.gz.b64", "public/export-core.js"],
  ["repair/export-fix.js.gz.b64", "public/export-fix.js"],
  ["repair/export-test.mjs.gz.b64", "scripts/export-test.mjs"],
];

for (const [source, target] of files) {
  const encoded = (await readFile(source, "utf8")).trim();
  const decoded = gunzipSync(Buffer.from(encoded, "base64"));
  await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  await writeFile(target, decoded);
}

console.log("Standalone export engine 20260731-4 installed.");
