import { copyFile, readFile, writeFile } from "node:fs/promises";

const release = "20260731-3";
const mainPath = "public/assets/index-anSa7LUY.js";
let code = await readFile(mainPath, "utf8");

function once(oldText, newText, label) {
  const oldCount = code.split(oldText).length - 1;
  const newCount = code.split(newText).length - 1;
  if (oldCount === 1) code = code.replace(oldText, newText);
  else if (!(oldCount === 0 && newCount === 1)) throw new Error(`${label}: alt=${oldCount}, neu=${newCount}`);
}

once(
  'async function ve(o,c={}){const a=await fetch(o,{credentials:"same-origin",headers:{"Content-Type":"application/json",...c.headers||{}},...c}),d=await a.json().catch(()=>({}));if(!a.ok)throw new Error(d.message||"Die Anfrage konnte nicht verarbeitet werden.");return d}',
  'async function ve(o,c={}){const a=await fetch(o,{credentials:"same-origin",headers:{"Content-Type":"application/json",...c.headers||{}},...c}),d=await a.text();let h={};try{h=d?JSON.parse(d):{}}catch{}if(!a.ok)throw new Error(h.message||d||"Die Anfrage konnte nicht verarbeitet werden ("+a.status+").");return h}',
  "API"
);
once(
  'c({tone:"success",text:"Anfrage gesendet. Bitte bestätige die E-Mail. Danach schaltet die Firma das Konto frei."}),d("login")',
  'c({tone:"success",text:"Anfrage gesendet. Bitte bestätige die E-Mail. Danach schaltet die Firma das Konto frei."})',
  "Registrierungserfolg"
);
once('date:un(),start:"07:00"', 'date:Tt(new Date),start:"07:00"', "Datum");
once(
  'catch{C({tone:"error",text:"Der Dienstplan konnte nicht als PDF erstellt werden."})}finally{E("")}}function fe',
  'catch(R){C({tone:"error",text:"Der Dienstplan konnte nicht als PDF erstellt werden."+((R instanceof Error&&R.message)?" "+R.message:"")})}finally{E("")}}function fe',
  "Dienstplanfehler"
);
once(
  'catch{E({tone:"error",text:"Der Stundenzettel konnte nicht erstellt werden."})}finally{C("")}}}async function ie',
  'catch(R){E({tone:"error",text:"Der Stundenzettel konnte nicht erstellt werden."+((R instanceof Error&&R.message)?" "+R.message:"")})}finally{C("")}}}async function ie',
  "Einzelberichtfehler"
);
once(
  'catch{E({tone:"error",text:"Die gemeinsame Monatsdatei konnte nicht erstellt werden."})}finally{C("")}}return',
  'catch(R){E({tone:"error",text:"Die gemeinsame Monatsdatei konnte nicht erstellt werden."+((R instanceof Error&&R.message)?" "+R.message:"")})}finally{C("")}}return',
  "Gesamtberichtfehler"
);

function functionBlock(name, nextName) {
  const start = code.indexOf(`async function ${name}(`);
  const end = code.indexOf(`async function ${nextName}(`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Funktion ${name} nicht gefunden`);
  return { start, end, text: code.slice(start, end) };
}
function replaceBlock(block, text) { code = code.slice(0, block.start) + text + code.slice(block.end); }

let block = functionBlock("lp", "ip");
if (!block.text.includes("toBlob();await habunSaveBlob")) {
  const changed = block.text.replace(/await h\(([\s\S]+)\)\.toFile\((`[^`]+`)\)\}$/, 'const B=await h($1).toBlob();await habunSaveBlob(B,$2,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}');
  if (changed === block.text) throw new Error("Einzel-Excel konnte nicht umgestellt werden");
  replaceBlock(block, changed);
}

block = functionBlock("ip", "habunSavePdfFile");
if (!block.text.includes("toBlob();await habunSaveBlob")) {
  const changed = block.text.replace(/await d\(w\)\.toFile\((`[^`]+`)\)\}$/, 'const B=await d(w).toBlob();await habunSaveBlob(B,$1,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}');
  if (changed === block.text) throw new Error("Gesamt-Excel konnte nicht umgestellt werden");
  replaceBlock(block, changed);
}

const saveHelper = 'async function habunSaveBlob(o,c,a=o.type||"application/octet-stream"){const d=typeof navigator<"u"?navigator:{},h=/iPad|iPhone|iPod/.test(d.userAgent||"")||d.platform==="MacIntel"&&d.maxTouchPoints>1;if(h&&typeof File==="function"&&typeof d.share==="function"&&typeof d.canShare==="function")try{const g=new File([o],c,{type:a});if(d.canShare({files:[g]})){await d.share({files:[g],title:c});return}}catch(g){if(g?.name==="AbortError")return}const w=URL.createObjectURL(o),N=document.createElement("a");N.href=w,N.download=c,N.rel="noopener",N.style.display="none",document.body.appendChild(N),N.click(),N.remove(),window.setTimeout(()=>URL.revokeObjectURL(w),12e4)}async function habunSavePdfFile(o,c){await habunSaveBlob(o.output("blob"),c,"application/pdf")}';
const existingBlobHelper = code.indexOf("async function habunSaveBlob(");
const existingPdfHelper = code.indexOf("async function habunSavePdfFile(");
const helperStart = existingBlobHelper >= 0 ? existingBlobHelper : existingPdfHelper;
const helperEnd = code.indexOf("async function sp(", helperStart);
if (helperStart >= 0 && helperEnd > helperStart) code = code.slice(0, helperStart) + saveHelper + code.slice(helperEnd);
else throw new Error("Download-Helfer fehlt");
if ((code.split("async function habunSaveBlob(").length - 1) !== 1) throw new Error("Download-Helfer ist mehrfach definiert");
if ((code.split("async function habunSavePdfFile(").length - 1) !== 1) throw new Error("PDF-Helfer ist mehrfach definiert");

once('y.save(`Habun-Stundenzettel-Alle-${c}.pdf`)', 'await habunSavePdfFile(y,`Habun-Stundenzettel-Alle-${c}.pdf`)', "Gesamt-PDF");
once('S.save(`Stundenzettel-${id(c.fullName)}-${a}.pdf`)', 'await habunSavePdfFile(S,`Stundenzettel-${id(c.fullName)}-${a}.pdf`)', "Einzel-PDF");
once('S.save(`Dienstplan-${a}-bis-${D}.pdf`)', 'await habunSavePdfFile(S,`Dienstplan-${a}-bis-${D}.pdf`)', "Dienstplan-PDF");

await writeFile(mainPath, code);
await copyFile(mainPath, `public/assets/index-habun-main-${release}.js`);

const zipPath = "public/assets/browser-BeRsew1z.js";
let zip = await readFile(zipPath, "utf8");
zip = zip.replace('else if(O<16e4)try{C(null,zr(E,s))}', 'else if(O<1e9)try{C(null,zr(E,s))}');
if (!zip.includes("O<1e9")) throw new Error("Safari-Excel-Patch fehlt");
await writeFile(zipPath, zip);

const pdfPath = "public/assets/jspdf.es.min-Dqzj63rK.js";
let pdf = await readFile(pdfPath, "utf8");
pdf = pdf.replaceAll("index-anSa7LUY.js", `index-habun-main-${release}.js`);
if (!pdf.includes(`index-habun-main-${release}.js`)) throw new Error("jsPDF-Bundle-Verweis fehlt");
await writeFile(pdfPath, pdf);
