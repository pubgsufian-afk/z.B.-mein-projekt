import { access, readFile } from "node:fs/promises";

const required = [
  "public/index.html",
  "public/robots.txt",
  "public/improvements.css",
  "public/improvements.js",
  "public/premium.css",
  "public/premium.js",
  "public/assets/index-anSa7LUY.js",
  "public/assets/index-habun-main-20260731-2.js",
  "netlify/functions/session.mts",
  "netlify/functions/settings.mts",
  "netlify/functions/work.mts",
  "netlify/functions/registrations.mts"
];

await Promise.all(required.map((file) => access(file)));
const index = await readFile("public/index.html", "utf8");
if (!index.includes("noindex,nofollow")) throw new Error("noindex fehlt");
if (!index.includes("improvements.js")) throw new Error("Verbesserungs-Skript fehlt");
if (!index.includes("premium.js")) throw new Error("Premium-Skript fehlt");
if (!index.includes("20260731-2")) throw new Error("Release-Marker fehlt");
if (index.includes("TESTPORTAL")) throw new Error("Testhinweis in Hauptversion gefunden");
console.log(`Prüfung erfolgreich · ${required.length} Kerndateien vorhanden`);
