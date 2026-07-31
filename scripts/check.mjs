import { access, readFile } from "node:fs/promises";

const release = "20260731-3";
const required = [
  "public/index.html",
  "public/robots.txt",
  "public/improvements.css",
  "public/improvements.js",
  "public/premium.css",
  "public/premium.js",
  "public/assets/index-anSa7LUY.js",
  `public/assets/index-habun-main-${release}.js`,
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
const bundle = await readFile("public/assets/index-anSa7LUY.js", "utf8");
const pdf = await readFile("public/assets/jspdf.es.min-Dqzj63rK.js", "utf8");
const zip = await readFile("public/assets/browser-BeRsew1z.js", "utf8");
if (!index.includes("noindex,nofollow")) throw new Error("noindex fehlt");
if (!index.includes("improvements.js")) throw new Error("Verbesserungs-Skript fehlt");
if (!index.includes("premium.js")) throw new Error("Premium-Skript fehlt");
if (!index.includes(release)) throw new Error("Release-Marker fehlt");
if (index.includes("TESTPORTAL")) throw new Error("Testhinweis in Hauptversion gefunden");
if (!bundle.includes("async function habunSaveBlob")) throw new Error("Universeller Datei-Download fehlt");
if ((bundle.match(/toBlob\(\);await habunSaveBlob/g) || []).length !== 2) throw new Error("Excel-Downloads sind nicht auf Blob-Speicherung umgestellt");
if (bundle.includes(".toFile(")) throw new Error("Alter Excel-Download ist noch aktiv");
if (!pdf.includes(`index-habun-main-${release}.js`)) throw new Error("jsPDF lädt das falsche Haupt-Bundle");
if (!zip.includes("O<1e9")) throw new Error("Safari-kompatible Excel-Komprimierung fehlt");
console.log(`Prüfung erfolgreich · ${required.length} Kerndateien vorhanden · Export-Release ${release}`);
