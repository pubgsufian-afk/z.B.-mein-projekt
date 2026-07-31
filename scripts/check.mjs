import { access, readFile } from "node:fs/promises";

const uiRelease = "20260731-6";
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
  "public/admin-time-fix.js",
  "public/schedule-multi-fix.js",
  "public/assets/index-anSa7LUY.js",
  `public/assets/index-habun-main-${bundleRelease}.js`,
  "public/assets/index-CBs7FW29.js",
  "public/assets/browser-BeRsew1z.js",
  "public/assets/jspdf.es.min-Dqzj63rK.js",
  "public/assets/jspdf.plugin.autotable-B0IxatYY.js",
  "scripts/admin-time-test.mjs",
  "scripts/schedule-multi-test.mjs",
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
const adminTime = await readFile("public/admin-time-fix.js", "utf8");
const scheduleMulti = await readFile("public/schedule-multi-fix.js", "utf8");
const workFunction = await readFile("netlify/functions/work.mts", "utf8");
const improvements = await readFile("public/improvements.css", "utf8");

if (!index.includes("noindex,nofollow")) throw new Error("noindex fehlt");
if (!index.includes("export-fix.js")) throw new Error("Unabhängige Export-Engine fehlt");
if (!index.includes("admin-time-fix.js")) throw new Error("Admin-Stundenzettel-Editor fehlt");
if (!index.includes("schedule-multi-fix.js")) throw new Error("Mehrfachstellen-Unterstützung fehlt");
if (index.indexOf("schedule-multi-fix.js") > index.indexOf("index-habun-main")) {
  throw new Error("Mehrfachstellen-Schutz muss vor der Portal-App geladen werden");
}
if (!index.includes(uiRelease)) throw new Error("UI-Release-Marker fehlt");
if (index.includes("TESTPORTAL")) throw new Error("Testhinweis in Hauptversion gefunden");
if (netlify.includes('from = "/*"')) throw new Error("Gefährliche HTML-Fallback-Weiterleitung ist noch aktiv");
if (!netlify.includes('for = "/admin-time-fix.js"')) throw new Error("JavaScript-Header für Admin-Editor fehlt");
if (!netlify.includes('for = "/schedule-multi-fix.js"')) throw new Error("JavaScript-Header für Mehrfachstellen fehlt");
if (!core.includes("createSingleReportPdf") || !core.includes("createSingleReportXlsx")) {
  throw new Error("Export-Kern ist unvollständig");
}
if (!fix.includes("stopImmediatePropagation") || !fix.includes("__HABUN_EXPORT_RELEASE__")) {
  throw new Error("Export-Übernahme ist nicht aktiv");
}
if (!adminTime.includes('resource: "management-time"')) throw new Error("Admin-Speicherfunktion fehlt");
if (!adminTime.includes("Neuen Stundenzettel eintragen")) throw new Error("Admin-Neuanlage fehlt");
if (!adminTime.includes("admin-time-quick-edit")) throw new Error("Mobile Bearbeiten-Aktion fehlt");
if (!improvements.includes(".admin-time-editor")) throw new Error("Admin-Editor-Stile fehlen");
if (!scheduleMulti.includes("multi-position-enabled")) throw new Error("Alte Überschneidungssperre wird nicht deaktiviert");
if (!scheduleMulti.includes("exakt identischer Doppeleintrag")) throw new Error("Hinweis zur Duplikatsregel fehlt");
if (!workFunction.includes('const MULTI_STORE = "portal-work-multi"')) throw new Error("Mehrfachstellen-Speicher fehlt");
if (!workFunction.includes("isExactDuplicate")) throw new Error("Exakte Duplikatsprüfung fehlt");
if (!workFunction.includes("X-Habun-Schedule-Mode")) throw new Error("Mehrfachstellen-API-Kennzeichnung fehlt");
if (/überschneid.*return error/i.test(workFunction)) throw new Error("Alte Überschneidungssperre ist noch aktiv");

console.log(`Prüfung erfolgreich · ${required.length} Kerndateien · UI ${uiRelease} · Bundle ${bundleRelease} · Mehrfachstellen aktiv`);
