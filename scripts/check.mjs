import { access, readFile } from "node:fs/promises";

const uiRelease = "20260731-4";
const bundleRelease = "20260731-3";
const required = [
  "public/index.html",
  "public/robots.txt",
  "public/improvements.css",
  "public/improvements.js",
  "public/premium.css",
  "public/premium.js",
  "public/export-core.js",
  "public/export-fix.js",
  "public/assets/index-anSa7LUY.js",
  `public/assets/index-habun-main-${bundleRelease}.js`,
  "public/assets/index-CBs7FW29.js",
  "public/assets/browser-BeRsew1z.js",
  "public/assets/jspdf.es.min-Dqzj63rK.js",
  "public/assets/jspdf.plugin.autotable-B0IxatYY.js",
  "netlify/functions/session.mts",
  "netlify/functions/settings.mts",
  "netlify/functions/work.mts",
  "netlify/functions/registrations.mts"
];

await Promise.all(required.map((file) => access(file)));
const index = await readFile("public/index.html", "utf8");
const netlify = await readFile("netlify.toml", "utf8");
const core = await readFile("public/export-core.js", "utf8");
const fix = await readFile("public/export-fix.js", "utf8");

if (!index.includes("noindex,nofollow")) throw new Error("noindex fehlt");
if (!index.includes("export-fix.js")) throw new Error("Unabhängige Export-Engine fehlt");
if (!index.includes(uiRelease)) throw new Error("UI-Release-Marker fehlt");
if (index.includes("TESTPORTAL")) throw new Error("Testhinweis in Hauptversion gefunden");
if (netlify.includes('from = "/*"')) throw new Error("Gefährliche HTML-Fallback-Weiterleitung ist noch aktiv");
if (!core.includes("createSingleReportPdf") || !core.includes("createSingleReportXlsx")) {
  throw new Error("Export-Kern ist unvollständig");
}
if (!fix.includes("stopImmediatePropagation") || !fix.includes("__HABUN_EXPORT_RELEASE__")) {
  throw new Error("Export-Übernahme ist nicht aktiv");
}

console.log(`Prüfung erfolgreich · ${required.length} Kerndateien · UI ${uiRelease} · Bundle ${bundleRelease}`);
